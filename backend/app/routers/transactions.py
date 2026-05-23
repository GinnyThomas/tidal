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
import math
from datetime import date, datetime, timezone
from typing import Optional

from collections import defaultdict
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import exists, func, or_
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.sql.expression import asc, desc

from app.database import get_db
from app.models.account import Account
from app.models.category import Category
from app.models.promotion import Promotion
from app.models.transaction import Transaction
from app.models.transaction_split import TransactionSplit
from app.models.user import User
from app.schemas.transaction import (
    CurrencyAmount,
    PaginatedTransactions,
    TransactionCreate,
    TransactionResponse,
    TransactionTotals,
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
        "is_split": tx.is_split,
        "splits": _build_splits_response(tx) if tx.is_split else [],
    }


def _build_splits_response(tx: Transaction) -> list[dict]:
    """Build split response dicts using the eager-loaded category relationship."""
    splits = tx.splits if hasattr(tx, 'splits') and tx.splits is not None else []
    return [
        {
            "id": s.id,
            "transaction_id": s.transaction_id,
            "category_id": s.category_id,
            "category_name": s.category.name if s.category else None,
            "promotion_id": s.promotion_id,
            "amount": s.amount,
            "note": s.note,
        }
        for s in splits
    ]


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

    # --- Split transaction handling ---
    has_splits = len(transaction_in.splits) > 0
    if has_splits:
        # Validate split amounts sum to the transaction total
        split_total = sum(s.amount for s in transaction_in.splits)
        if split_total != transaction_in.amount:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Split amounts ({split_total}) must equal transaction amount ({transaction_in.amount}).",
            )
        # Validate split category and promotion ownership
        for s in transaction_in.splits:
            if s.category_id is not None:
                _get_category_or_404(s.category_id, current_user.id, db)
            if s.promotion_id is not None:
                _get_promotion_or_404(s.promotion_id, current_user.id, db)

    transaction = Transaction(
        user_id=current_user.id,
        account_id=transaction_in.account_id,
        category_id=None if has_splits else transaction_in.category_id,
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
        is_split=has_splits,
    )
    db.add(transaction)
    db.flush()  # Get the transaction.id for split FKs

    if has_splits:
        for s in transaction_in.splits:
            db.add(TransactionSplit(
                transaction_id=transaction.id,
                category_id=s.category_id,
                promotion_id=s.promotion_id,
                amount=s.amount,
                note=s.note,
            ))

    db.commit()
    db.refresh(transaction)
    return _build_tx_response(transaction, category)


@router.get(
    "",
    response_model=PaginatedTransactions,
)
def list_transactions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    account_id: Optional[uuid.UUID] = Query(default=None),
    category_id: Optional[uuid.UUID] = Query(default=None),
    status: Optional[str] = Query(default=None),
    parent_transaction_id: Optional[uuid.UUID] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    sort_by: str = Query(default="date"),
    sort_dir: str = Query(default="desc"),
    search: Optional[str] = Query(default=None),
) -> dict:
    """
    Returns paginated, non-deleted transactions for the current user.

    Optional filters:
      account_id  — return only transactions for a specific account.
      category_id — return only transactions for a specific category.
                    Supports the category drill-down feature: clicking a
                    category navigates to /transactions?category_id=<uuid>.
      status      — comma-separated list of statuses to include.
                    e.g. "cleared,reconciled" returns only settled transactions.
                    This is the query the budget engine uses to compute
                    "actual spend" — pending transactions are deliberately excluded.
      date_from   — include transactions on or after this date.
      date_to     — include transactions on or before this date.
      page        — page number (1-based, default 1).
      page_size   — items per page (1-500, default 50).
      sort_by     — field to sort by: date, payee, amount, status,
                    category_name, account_name. Default: date.
      sort_dir    — sort direction: asc or desc. Default: desc.
      search      — case-insensitive substring match against payee and note.
    """
    query = db.query(Transaction).filter(
        Transaction.user_id == current_user.id,
        Transaction.deleted_at.is_(None),
    )

    if account_id is not None:
        query = query.filter(Transaction.account_id == account_id)

    if category_id is not None:
        # Include split transactions that have a split with the requested
        # category, not just transactions with category_id directly set.
        query = query.filter(
            or_(
                Transaction.category_id == category_id,
                exists().where(
                    TransactionSplit.transaction_id == Transaction.id,
                    TransactionSplit.category_id == category_id,
                )
            )
        )

    if status is not None:
        status_list = [s.strip() for s in status.split(",") if s.strip()]
        query = query.filter(Transaction.status.in_(status_list))

    if parent_transaction_id is not None:
        query = query.filter(Transaction.parent_transaction_id == parent_transaction_id)

    if date_from is not None:
        query = query.filter(Transaction.date >= date_from)

    if date_to is not None:
        query = query.filter(Transaction.date <= date_to)

    if search is not None:
        search = search.strip()
    if search:
        term = f"%{search}%"
        query = query.filter(
            or_(
                Transaction.payee.ilike(term),
                Transaction.note.ilike(term),
            )
        )

    # --- Compute totals across ALL filtered rows (before pagination) ---
    # Use a subquery of matching IDs so the aggregation runs in SQL, not Python.
    # .order_by(None) strips any ORDER BY from the source query — the subquery
    # only needs to be a set of IDs, not an ordered list.
    id_subq = query.order_by(None).with_entities(Transaction.id).subquery()

    expenses_by_currency: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    income_by_currency: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    transfers_by_currency: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))

    # Non-split transactions: aggregate by (type, currency)
    non_split_rows = (
        db.query(
            Transaction.transaction_type,
            Transaction.currency,
            func.sum(Transaction.amount),
        )
        .filter(Transaction.id.in_(db.query(id_subq.c.id)), Transaction.is_split.is_(False))
        .group_by(Transaction.transaction_type, Transaction.currency)
        .all()
    )
    # Split transactions: sum split amounts grouped by parent's (type, currency)
    split_rows = (
        db.query(
            Transaction.transaction_type,
            Transaction.currency,
            func.sum(TransactionSplit.amount),
        )
        .join(TransactionSplit, TransactionSplit.transaction_id == Transaction.id)
        .filter(Transaction.id.in_(db.query(id_subq.c.id)), Transaction.is_split.is_(True))
        .group_by(Transaction.transaction_type, Transaction.currency)
        .all()
    )

    # Refunds intentionally excluded from totals — pending refactor (see tech debt).
    # A refund should zero out the original category spend, not appear as income.
    for tx_type, currency, amount in [*non_split_rows, *split_rows]:
        amt = amount or Decimal("0")
        if tx_type == "expense":
            expenses_by_currency[currency] += amt
        elif tx_type == "income":
            income_by_currency[currency] += amt
        elif tx_type == "transfer":
            transfers_by_currency[currency] += amt
        # tx_type == "refund" is intentionally not bucketed

    # Net = income - expenses per currency (transfers excluded).
    # Include zero net for currencies that have activity (income or expenses)
    # so the UI can distinguish "net zero" from "no data".
    all_currencies = set(expenses_by_currency.keys()) | set(income_by_currency.keys())
    net_by_currency: dict[str, Decimal] = {}
    for c in all_currencies:
        net_by_currency[c] = income_by_currency.get(c, Decimal("0")) - expenses_by_currency.get(c, Decimal("0"))

    def to_currency_list(d: dict[str, Decimal]) -> list[dict]:
        return [{"currency": c, "amount": a} for c, a in sorted(d.items()) if a != Decimal("0")]

    totals = {
        "expenses": to_currency_list(expenses_by_currency),
        "income": to_currency_list(income_by_currency),
        "transfers": to_currency_list(transfers_by_currency),
        "net": [{"currency": c, "amount": a} for c, a in sorted(net_by_currency.items())],
    }

    # Count before pagination
    total = query.count()
    total_pages = max(1, math.ceil(total / page_size))
    # Clamp page so requesting beyond the last page returns the last page
    page = min(page, total_pages) if total > 0 else 1

    # Build sort clause
    direction = desc if sort_dir == "desc" else asc
    SORT_COLUMNS = {
        "date": Transaction.date,
        "payee": Transaction.payee,
        "amount": Transaction.amount,
        "status": Transaction.status,
        "category_name": Category.name,
        "account_name": Account.name,
    }
    sort_col = SORT_COLUMNS.get(sort_by, Transaction.date)

    if sort_by == "category_name":
        query = query.outerjoin(Category, Transaction.category_id == Category.id)
    elif sort_by == "account_name":
        query = query.outerjoin(Account, Transaction.account_id == Account.id)

    transactions = (
        query
        .order_by(direction(sort_col), desc(Transaction.created_at))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .options(
            selectinload(Transaction.splits).selectinload(TransactionSplit.category)
        )
        .all()
    )

    # Batch-fetch all referenced categories in a single query to avoid N+1.
    category_ids = {tx.category_id for tx in transactions if tx.category_id is not None}
    cat_map: dict = {}
    if category_ids:
        cat_list = db.query(Category).filter(Category.id.in_(category_ids)).all()
        cat_map = {c.id: c for c in cat_list}

    return {
        "items": [_build_tx_response(tx, cat_map.get(tx.category_id)) for tx in transactions],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "totals": totals,
    }


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

    # Handle splits update
    if "splits" in update_data:
        splits_data = update_data.pop("splits")
        if splits_data is not None:
            # Delete existing splits
            db.query(TransactionSplit).filter(
                TransactionSplit.transaction_id == transaction.id
            ).delete()
            if len(splits_data) > 0:
                # Validate split amounts
                split_total = sum(Decimal(str(s["amount"])) for s in splits_data)
                tx_amount = update_data.get("amount", transaction.amount)
                if split_total != tx_amount:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=f"Split amounts ({split_total}) must equal transaction amount ({tx_amount}).",
                    )
                # Validate ownership of each split's category and promotion
                for s in splits_data:
                    if s.get("category_id") is not None:
                        _get_category_or_404(s["category_id"], current_user.id, db)
                    if s.get("promotion_id") is not None:
                        _get_promotion_or_404(s["promotion_id"], current_user.id, db)
                for s in splits_data:
                    db.add(TransactionSplit(
                        transaction_id=transaction.id,
                        category_id=s.get("category_id"),
                        promotion_id=s.get("promotion_id"),
                        amount=s["amount"],
                        note=s.get("note"),
                    ))
                transaction.is_split = True
                transaction.category_id = None
            else:
                transaction.is_split = False

    # Enum fields need .value to store the plain string in the database
    for field, value in update_data.items():
        if field in ("transaction_type", "status") and value is not None:
            value = value.value
        setattr(transaction, field, value)

    db.commit()
    db.refresh(transaction)
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
