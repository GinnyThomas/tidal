# app/routers/accounts.py
#
# Purpose: HTTP endpoints for managing accounts.
#
# Endpoints:
#   POST   /api/v1/accounts              → create a new account (201)
#   GET    /api/v1/accounts              → list all active accounts for the current user (200)
#   GET    /api/v1/accounts/{account_id} → get a single account by ID (200 or 404)
#   PUT    /api/v1/accounts/{account_id} → update an account (200 or 404)
#   DELETE /api/v1/accounts/{account_id} → soft-delete an account (204 or 404)
#
# Security model:
#   Every endpoint requires a valid JWT via Depends(get_current_user).
#   Every query filters by current_user.id — a user can never see or modify
#   another user's accounts, even if they guess the UUID. We return 404 (not
#   403) when an account doesn't belong to the user, to avoid confirming that
#   the account exists at all (information leakage).
#
# Soft delete:
#   DELETE sets deleted_at to the current UTC time. It does NOT remove the row.
#   All list and get queries filter WHERE deleted_at IS NULL, so soft-deleted
#   accounts are invisible through the API but preserved in the database for
#   audit purposes.

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from decimal import Decimal

from app.database import get_db
from app.models.account import Account
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.account import AccountCreate, AccountResponse, AccountUpdate
from app.services.auth import get_current_user


router = APIRouter(
    prefix="/api/v1/accounts",
    tags=["accounts"],
)


# =============================================================================
# Helpers
# =============================================================================


def _get_account_or_404(
    account_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session,
) -> Account:
    """
    Fetch an account by ID for a specific user. Raises 404 if not found,
    already deleted, or belongs to a different user.

    This is a shared helper used by get, update, and delete endpoints
    to avoid repeating the same query and error-raising logic three times.
    It's defined here (not in a services file) because it's tightly coupled
    to the HTTP layer — it raises HTTPException directly.
    """
    account = (
        db.query(Account)
        .filter(
            Account.id == account_id,
            Account.user_id == user_id,
            Account.deleted_at.is_(None),  # exclude soft-deleted rows
        )
        .first()
    )
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found.",
        )
    return account


def _calculate_balance(
    account_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session,
    account_type: str = "checking",
) -> Decimal:
    """
    Compute the current balance for an account based on its transactions.

    For debit accounts (checking, savings, etc.):
        Returns the net transaction effect on the account balance

    For credit_card accounts the perspective is inverted — the balance
    represents money OWED, not money held:
        Balance = opening + expenses − payments
        Expenses increase (more owed), income/payments decrease (less owed),
        refunds decrease (merchant returned money, reducing what's owed).

    Transfers: the debit leg (parent_transaction_id=None) always moves money
    OUT of the source account; the credit leg moves money IN. For a credit
    card the debit leg increases the owed balance (cash advance or payment
    from the card) and the credit leg decreases it (payment received).
    """
    transactions = (
        db.query(Transaction)
        .filter(
            Transaction.account_id == account_id,
            Transaction.user_id == user_id,
            Transaction.deleted_at.is_(None),
            Transaction.status.in_(["cleared", "reconciled"]),
        )
        .all()
    )

    is_credit_card = account_type == "credit_card"

    total = Decimal("0")
    for tx in transactions:
        if tx.transaction_type == "income":
            if is_credit_card:
                total -= tx.amount  # payment reduces what's owed
            else:
                total += tx.amount
        elif tx.transaction_type == "expense":
            if is_credit_card:
                total += tx.amount  # purchase increases what's owed
            else:
                total -= tx.amount
        elif tx.transaction_type == "transfer":
            # Parent leg (debit/from) has parent_transaction_id = None
            # Child leg (credit/to) has parent_transaction_id set
            if tx.parent_transaction_id is None:
                if is_credit_card:
                    total += tx.amount  # e.g. cash advance — increases owed
                else:
                    total -= tx.amount  # money left this account
            else:
                if is_credit_card:
                    total -= tx.amount  # payment received — reduces owed
                else:
                    total += tx.amount  # money arrived at this account
        elif tx.transaction_type == "refund":
            if is_credit_card:
                total -= tx.amount  # merchant refund reduces what's owed
            else:
                total += tx.amount  # refund returns money

    return total


def _to_response(account: Account, db: Session) -> dict:
    """Build account response dict with computed calculated_balance."""
    opening = account.current_balance
    tx_balance = _calculate_balance(account.id, account.user_id, db, account.account_type)
    return {
        "id": account.id,
        "user_id": account.user_id,
        "name": account.name,
        "account_type": account.account_type,
        "currency": account.currency,
        "current_balance": opening,
        "calculated_balance": opening + tx_balance,
        "is_manual": account.is_manual,
        "institution": account.institution,
        "is_active": account.is_active,
        "note": account.note,
        "created_at": account.created_at,
    }


# =============================================================================
# Endpoints
# =============================================================================


@router.post(
    "",
    response_model=AccountResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_account(
    account_in: AccountCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Creates a new account owned by the authenticated user.

    user_id comes from the JWT — the client cannot choose which user owns
    the account. is_manual defaults to True on the model; all API-created
    accounts are manual. is_active defaults to True.

    account_in.account_type is an AccountType enum — we call .value to store
    the plain string ("checking", "savings", etc.) in the database.
    """
    account = Account(
        user_id=current_user.id,
        name=account_in.name,
        account_type=account_in.account_type.value,
        currency=account_in.currency,
        current_balance=account_in.current_balance,
        institution=account_in.institution,
        note=account_in.note,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return _to_response(account, db)


@router.get(
    "",
    response_model=list[AccountResponse],
)
def list_accounts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    """
    Returns all active (non-deleted) accounts belonging to the current user.

    Filtered by user_id (data scoping), is_active IS TRUE (archived accounts
    are excluded), and deleted_at IS NULL (soft delete).
    Soft-deleted and archived accounts are permanently excluded from this view.
    """
    accounts = (
        db.query(Account)
        .filter(
            Account.user_id == current_user.id,
            Account.is_active.is_(True),
            Account.deleted_at.is_(None),
        )
        .all()
    )
    return [_to_response(a, db) for a in accounts]


@router.get(
    "/{account_id}",
    response_model=AccountResponse,
)
def get_account(
    account_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Returns a single account by ID with computed calculated_balance.
    """
    account = _get_account_or_404(account_id, current_user.id, db)
    return _to_response(account, db)


@router.put(
    "/{account_id}",
    response_model=AccountResponse,
)
def update_account(
    account_id: uuid.UUID,
    account_in: AccountUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Updates an account with the provided fields.

    We use model_dump(exclude_unset=True) to get only the fields the client
    actually sent — fields omitted from the request body are not touched.
    This makes PUT behave like a partial update (similar to PATCH), which is
    more client-friendly: you don't need to send the full object to change one field.

    account_type requires special handling because it's an enum in the schema
    but stored as a plain string in the database.
    """
    account = _get_account_or_404(account_id, current_user.id, db)

    # exclude_unset=True: if the client sent {"name": "New Name"}, this returns
    # {"name": "New Name"} only — currency, balance etc. are not touched.
    update_data = account_in.model_dump(exclude_unset=True)

    NON_NULLABLE = {"name", "account_type", "currency", "current_balance"}
    for field in NON_NULLABLE:
        if field in update_data and update_data[field] is None:
            raise HTTPException(status_code=422, detail=f"{field} cannot be null")

    for field, value in update_data.items():
        # AccountType is a str Enum — its .value is the plain string we store.
        if field == "account_type" and value is not None:
            value = value.value
        setattr(account, field, value)

    db.commit()
    db.refresh(account)
    return _to_response(account, db)


@router.delete(
    "/{account_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_account(
    account_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """
    Soft-deletes an account by setting deleted_at to the current UTC time.

    The row is NOT removed from the database — it's just hidden from all
    queries that filter WHERE deleted_at IS NULL. This preserves the audit
    trail and makes recovery possible.

    Returns 204 No Content on success (no body needed — the action speaks
    for itself). Returns 404 if the account isn't found or already deleted.
    """
    account = _get_account_or_404(account_id, current_user.id, db)
    account.deleted_at = datetime.now(timezone.utc)
    db.commit()
    # No return value — 204 responses must have no body.
