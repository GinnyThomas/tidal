# app/routers/transactions.py
#
# Purpose: HTTP endpoints for managing transactions.
#
# Endpoints:
#   POST   /api/v1/transactions              → create expense/income/refund (201)
#   POST   /api/v1/transactions/transfer     → create transfer pair atomically (201)
#   GET    /api/v1/transactions              → list transactions (200)
#   GET    /api/v1/transactions/{id}         → get single transaction (200 or 404)
#   PUT    /api/v1/transactions/{id}         → update transaction (200 or 404)
#   DELETE /api/v1/transactions/{id}         → soft-delete transaction (204 or 404)
#
# Query parameters for GET /api/v1/transactions:
#   account_id — filter to a single account's transactions
#   status     — comma-separated values, e.g. "cleared,reconciled"
#                This is how the budget engine requests "actual spend":
#                only cleared and reconciled transactions count.
#
# Transfer semantics:
#   A transfer involves two accounts. The router creates two Transaction rows:
#     - Debit leg: from_account, type=transfer, no parent
#     - Credit leg: to_account, type=transfer, parent_transaction_id = debit.id
#   Both legs share the same date, amount, currency, category, and note.
#   They are committed in a single transaction so neither leg exists without
#   the other.
#
#   How the linking works without a DB round-trip:
#     We call uuid.uuid4() explicitly in Python and pass the same UUID as
#     both the debit's `id` and the credit's `parent_transaction_id`.
#     SQLAlchemy's `default=callable` fires during flush — not at object
#     construction — so we cannot rely on debit.id being set before the INSERT.
#     Generating the UUID ourselves keeps everything in memory and allows a
#     single add_all() + commit() with no intermediate flush.
#
# Security model:
#   All endpoints require a valid JWT via Depends(get_current_user).
#   Every query scopes to current_user.id. We also validate that referenced
#   accounts belong to the current user (prevents a user injecting a
#   transaction into another user's account by guessing account UUIDs).

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.account import Account
from app.models.category import Category
from app.models.promotion import Promotion
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.transaction import (
    TransactionCreate,
    TransactionResponse,
    TransactionType,
    TransactionUpdate,
    TransferCreate,
)
from app.services.auth import get_current_user


router = APIRouter(
    prefix="/api/v1/transactions",
    tags=["transactions"],
)


# =============================================================================
# Helpers
# =============================================================================


def _get_transaction_or_404(
    transaction_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session,
) -> Transaction:
    """
    Fetch a non-deleted transaction by ID scoped to the given user.
    Raises 404 if not found, soft-deleted, or belongs to another user.

    Same 404-instead-of-403 pattern as accounts: we don't confirm whether
    a resource exists for a different user.
    """
    transaction = (
        db.query(Transaction)
        .filter(
            Transaction.id == transaction_id,
            Transaction.user_id == user_id,
            Transaction.deleted_at.is_(None),
        )
        .first()
    )
    if transaction is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transaction not found.",
        )
    return transaction


def _get_promotion_or_404(
    promotion_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session,
) -> Promotion:
    """Validate that a promotion exists and belongs to the user."""
    promotion = (
        db.query(Promotion)
        .filter(Promotion.id == promotion_id, Promotion.user_id == user_id)
        .first()
    )
    if promotion is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Promotion not found.",
        )
    return promotion


def _get_account_or_404(
    account_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session,
) -> Account:
    """
    Validate that an account exists and belongs to the current user.
    Used when creating transactions to prevent cross-user account injection.
    """
    account = (
        db.query(Account)
        .filter(
            Account.id == account_id,
            Account.user_id == user_id,
            Account.deleted_at.is_(None),
        )
        .first()
    )
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found.",
        )
    return account


def _get_category_or_404(
    category_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session,
) -> Category:
    """
    Validate that a category exists, belongs to the current user, and is not
    soft-deleted. Used on create and update to prevent cross-user category use.
    """
    category = (
        db.query(Category)
        .filter(
            Category.id == category_id,
            Category.user_id == user_id,
            Category.deleted_at.is_(None),
        )
        .first()
    )
    if category is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found.",
        )
    return category


def _build_tx_response(tx: Transaction, category: Category | None) -> dict:
    """
    Build a dict matching TransactionResponse, adding category_name and
    category_icon from the related Category row.

    Why return a dict instead of the ORM object?
      TransactionResponse now includes category_name and category_icon, which
      are NOT attributes on the Transaction model. Pydantic's from_attributes
      reads ORM attributes by name — it can't traverse the relationship to get
      category.name. Building the dict ourselves lets us attach those values
      without needing SQLAlchemy relationship loading.

    FastAPI validates dicts against response_model the same way it validates
    ORM objects, so the field serializers (Decimal → str) still fire.
    """
    return {
        "id": tx.id,
        "user_id": tx.user_id,
        "account_id": tx.account_id,
        "category_id": tx.category_id,
        "schedule_id": tx.schedule_id,
        "promotion_id": tx.promotion_id,
        "parent_transaction_id": tx.parent_transaction_id,
        "date": tx.date,
        "payee": tx.payee,
        "amount": tx.amount,
        "currency": tx.currency,
        "exchange_rate": tx.exchange_rate,
        "transaction_type": tx.transaction_type,
        "status": tx.status,
        "note": tx.note,
        "created_at": tx.created_at,
        "category_name": category.name if category else None,
        "category_icon": category.icon if category else None,
    }


# =============================================================================
# Endpoints
# =============================================================================


@router.post(
    "/transfer",
    response_model=list[TransactionResponse],
    status_code=status.HTTP_201_CREATED,
)
def create_transfer(
    transfer_in: TransferCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    """
    Creates two linked Transaction rows atomically — a debit leg and a
    credit leg — representing a transfer between two of the user's accounts.

    Why this route is defined BEFORE the generic POST "" route:
      FastAPI matches routes in registration order. If "" were registered
      first, a POST to "/transfer" could theoretically conflict on some
      router implementations. Defining the specific path first is safer.

    Returns a list of two TransactionResponse objects (debit first, credit
    second) with status 201 Created.
    """
    # Fix 4: a transfer must move money between two DIFFERENT accounts
    if transfer_in.from_account_id == transfer_in.to_account_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Transfer source and destination accounts must be different.",
        )

    # Validate both accounts belong to the current user
    _get_account_or_404(transfer_in.from_account_id, current_user.id, db)
    _get_account_or_404(transfer_in.to_account_id, current_user.id, db)

    # Generate the debit's UUID in Python so we can pass it to the credit leg
    # as parent_transaction_id WITHOUT needing a DB flush first.
    #
    # Why explicit uuid.uuid4() here instead of relying on the model default?
    #   SQLAlchemy's `default=callable` fires during the INSERT (flush), not at
    #   object construction time. So `debit.id` would be None right after
    #   `Transaction(...)` if we didn't pass it explicitly. The model default
    #   handles single-row inserts fine (no other object needs the id in memory),
    #   but here we need the id available immediately to assign to credit.
    debit_id = uuid.uuid4()

    debit = Transaction(
        id=debit_id,
        user_id=current_user.id,
        account_id=transfer_in.from_account_id,
        category_id=None,
        date=transfer_in.date,
        amount=transfer_in.amount,
        currency=transfer_in.currency,
        transaction_type="transfer",
        status="cleared",   # Transfers are always cleared — both legs settle together
        note=transfer_in.note,
    )

    # Credit leg references the debit by the id we just generated.
    credit = Transaction(
        user_id=current_user.id,
        account_id=transfer_in.to_account_id,
        category_id=None,
        date=transfer_in.date,
        amount=transfer_in.amount,
        currency=transfer_in.currency,
        transaction_type="transfer",
        status="cleared",
        note=transfer_in.note,
        parent_transaction_id=debit_id,
    )

    db.add_all([debit, credit])
    db.commit()
    db.refresh(debit)
    db.refresh(credit)
    return [_build_tx_response(debit, None), _build_tx_response(credit, None)]


@router.post(
    "",
    response_model=TransactionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_transaction(
    transaction_in: TransactionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Creates a single transaction (expense, income, or refund).

    Transfers must use POST /api/v1/transactions/transfer — that endpoint
    creates both legs atomically and handles the parent_transaction_id link.

    Validations performed before inserting:
      - account_id must belong to the current user
      - category_id must belong to the current user
      - if transaction_type is refund, parent_transaction_id is required
      - if parent_transaction_id is provided, it must exist and belong to the user
    """
    # Fix 2: transfers have two legs and must use the dedicated endpoint
    if transaction_in.transaction_type == TransactionType.transfer:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Use POST /api/v1/transactions/transfer to create transfers.",
        )

    # Fix 1: validate account and category ownership.
    # Capture the category so we can include its name/icon in the response.
    _get_account_or_404(transaction_in.account_id, current_user.id, db)
    # Category is optional for all transaction types. Transfers typically
    # have no category; expense/income/refund transactions usually do, but
    # it's valid to omit it (e.g. a credit card payment has no category).
    category = None
    if transaction_in.category_id is not None:
        category = _get_category_or_404(transaction_in.category_id, current_user.id, db)

    # Fix 3: refunds must reference a parent transaction
    if (
        transaction_in.transaction_type == TransactionType.refund
        and transaction_in.parent_transaction_id is None
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Refund transactions must include parent_transaction_id.",
        )

    # If a parent is provided, validate it exists and belongs to user
    if transaction_in.parent_transaction_id is not None:
        _get_transaction_or_404(transaction_in.parent_transaction_id, current_user.id, db)

    # Validate promotion ownership if provided
    if transaction_in.promotion_id is not None:
        _get_promotion_or_404(transaction_in.promotion_id, current_user.id, db)

    transaction = Transaction(
        user_id=current_user.id,
        account_id=transaction_in.account_id,
        category_id=transaction_in.category_id,
        date=transaction_in.date,
        amount=transaction_in.amount,
        currency=transaction_in.currency,
        exchange_rate=transaction_in.exchange_rate,
        transaction_type=transaction_in.transaction_type.value,
        status=transaction_in.status.value,
        payee=transaction_in.payee,
        note=transaction_in.note,
        parent_transaction_id=transaction_in.parent_transaction_id,
        promotion_id=transaction_in.promotion_id,
    )
    db.add(transaction)
    db.commit()
    db.refresh(transaction)
    return _build_tx_response(transaction, category)


@router.get(
    "",
    response_model=list[TransactionResponse],
)
def list_transactions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    account_id: Optional[uuid.UUID] = Query(default=None),
    category_id: Optional[uuid.UUID] = Query(default=None),
    status: Optional[str] = Query(default=None),
    parent_transaction_id: Optional[uuid.UUID] = Query(default=None),
) -> list[dict]:
    """
    Returns all non-deleted transactions for the current user.

    Optional filters:
      account_id  — return only transactions for a specific account.
      category_id — return only transactions for a specific category.
                    Supports the category drill-down feature: clicking a
                    category navigates to /transactions?category_id=<uuid>.
      status      — comma-separated list of statuses to include.
                    e.g. "cleared,reconciled" returns only settled transactions.
                    This is the query the budget engine uses to compute
                    "actual spend" — pending transactions are deliberately excluded.
    """
    query = db.query(Transaction).filter(
        Transaction.user_id == current_user.id,
        Transaction.deleted_at.is_(None),
    )

    if account_id is not None:
        query = query.filter(Transaction.account_id == account_id)

    if category_id is not None:
        query = query.filter(Transaction.category_id == category_id)

    if status is not None:
        status_list = [s.strip() for s in status.split(",") if s.strip()]
        query = query.filter(Transaction.status.in_(status_list))

    if parent_transaction_id is not None:
        query = query.filter(Transaction.parent_transaction_id == parent_transaction_id)

    transactions = query.all()

    # Batch-fetch all referenced categories in a single query to avoid N+1.
    # {tx.category_id for tx in transactions} collects the unique IDs.
    category_ids = {tx.category_id for tx in transactions if tx.category_id is not None}
    cat_map: dict = {}
    if category_ids:
        cat_list = (
            db.query(Category)
            .filter(Category.id.in_(category_ids))
            .all()
        )
        cat_map = {c.id: c for c in cat_list}

    return [_build_tx_response(tx, cat_map.get(tx.category_id)) for tx in transactions]


@router.get(
    "/{transaction_id}",
    response_model=TransactionResponse,
)
def get_transaction(
    transaction_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Returns a single transaction by ID.

    Returns 404 if not found, soft-deleted, or belongs to another user.
    """
    tx = _get_transaction_or_404(transaction_id, current_user.id, db)
    category = db.query(Category).filter(Category.id == tx.category_id).first() if tx.category_id else None
    return _build_tx_response(tx, category)


@router.put(
    "/{transaction_id}",
    response_model=TransactionResponse,
)
def update_transaction(
    transaction_id: uuid.UUID,
    transaction_in: TransactionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Updates a transaction with the provided fields (partial update).

    Uses exclude_unset=True so only fields the client explicitly sent are
    changed — omitted fields keep their existing values.
    """
    transaction = _get_transaction_or_404(transaction_id, current_user.id, db)

    update_data = transaction_in.model_dump(exclude_unset=True)

    # Fix 6: guard against explicitly nulling non-nullable fields.
    # exclude_unset=True already omits fields the client didn't send, but a
    # client can still send {"amount": null} — reject that here before writing.
    NON_NULLABLE = {"date", "amount", "currency", "status", "transaction_type",
                    "account_id"}
    for field in NON_NULLABLE:
        if field in update_data and update_data[field] is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"'{field}' cannot be null.",
            )

    # Fix 7: validate ownership of referenced foreign keys if they are being changed
    if "account_id" in update_data and update_data["account_id"] is not None:
        _get_account_or_404(update_data["account_id"], current_user.id, db)

    if "category_id" in update_data and update_data["category_id"] is not None:
        _get_category_or_404(update_data["category_id"], current_user.id, db)

    # category_id is now fully optional for all transaction types — no
    # rejection when nulling it. Credit card payments and other uncategorised
    # transactions are valid.

    if "parent_transaction_id" in update_data and update_data["parent_transaction_id"] is not None:
        _get_transaction_or_404(update_data["parent_transaction_id"], current_user.id, db)

    if "promotion_id" in update_data and update_data["promotion_id"] is not None:
        _get_promotion_or_404(update_data["promotion_id"], current_user.id, db)

    # Enum fields need .value to store the plain string in the database
    for field, value in update_data.items():
        if field in ("transaction_type", "status") and value is not None:
            value = value.value
        setattr(transaction, field, value)

    db.commit()
    db.refresh(transaction)
    # Look up the (potentially updated) category for the response
    category = db.query(Category).filter(Category.id == transaction.category_id).first() if transaction.category_id else None
    return _build_tx_response(transaction, category)


@router.delete(
    "/{transaction_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_transaction(
    transaction_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """
    Soft-deletes a transaction by setting deleted_at to the current UTC time.

    The row is preserved in the database for audit purposes. All queries
    filter WHERE deleted_at IS NULL, making this transaction invisible.

    Returns 204 No Content on success.
    """
    transaction = _get_transaction_or_404(transaction_id, current_user.id, db)
    transaction.deleted_at = datetime.now(timezone.utc)
    db.commit()
