# app/schemas/transaction.py
#
# Purpose: Pydantic v2 schemas for Transaction request and response shapes.
#
# Schemas:
#   TransactionType   — enum of valid transaction types
#   TransactionStatus — enum of valid transaction statuses
#   TransactionCreate — request body for POST /api/v1/transactions
#   TransactionResponse — response for all transaction endpoints
#   TransactionUpdate — partial update for PUT /api/v1/transactions/{id}
#   TransferCreate    — request body for POST /api/v1/transactions/transfer
#                       (special schema because a transfer involves two accounts)
#
# Why separate TransferCreate?
#   A transfer requires from_account_id and to_account_id — two different
#   accounts. Regular transactions only reference one account. Rather than
#   making account_id optional and adding conditional validation, a dedicated
#   schema is cleaner and makes the intent explicit.
#
# Amount serialisation:
#   Per CLAUDE.md: "Amounts as strings (not floats)". The @field_serializer
#   converts Decimal → str with exactly 2 decimal places before the response
#   is sent. This prevents precision loss in JavaScript (IEEE 754 doubles
#   can't represent all decimal fractions exactly).

import uuid
from datetime import date as date_, datetime
from decimal import Decimal
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_serializer


class TransactionType(str, Enum):
    """
    Valid transaction types. Inherits from str so enum values compare directly
    to strings — TransactionType.expense == "expense" is True. This avoids
    calling .value when storing to the database.
    """

    expense = "expense"
    income = "income"
    transfer = "transfer"
    refund = "refund"


class TransactionStatus(str, Enum):
    """
    Valid transaction statuses.
    Only cleared and reconciled count toward budget actual spend.
    """

    pending = "pending"
    cleared = "cleared"
    reconciled = "reconciled"


class TransactionSplitCreate(BaseModel):
    """One split within a split transaction request."""

    category_id: Optional[uuid.UUID] = None
    promotion_id: Optional[uuid.UUID] = None
    # ge=0: a split is a slice of the (always non-negative) transaction total,
    # never a signed value.
    amount: Decimal = Field(..., ge=0)
    note: Optional[str] = None


class TransactionSplitResponse(BaseModel):
    """One split within a transaction response."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    transaction_id: uuid.UUID
    category_id: Optional[uuid.UUID]
    category_name: Optional[str] = None
    promotion_id: Optional[uuid.UUID]
    amount: Decimal
    note: Optional[str]

    @field_serializer("amount")
    def serialize_amount(self, value: Decimal) -> str:
        return str(value.quantize(Decimal("0.01")))


class TransactionCreate(BaseModel):
    """
    Request body for POST /api/v1/transactions.

    Used for creating expense, income, and refund transactions.
    For transfers use TransferCreate + POST /api/v1/transactions/transfer.

    Fields not here (id, user_id, schedule_id, created_at, updated_at) are
    set server-side. schedule_id is intentionally absent — Phase 5 adds it.
    """

    account_id: uuid.UUID
    category_id: Optional[uuid.UUID] = None
    date: date_
    # ge=0: amount is always a positive magnitude — direction comes from
    # transaction_type (and account_type for credit cards), never from the
    # sign of amount. See _calculate_balance() in routers/accounts.py.
    amount: Decimal = Field(..., ge=0)
    transaction_type: TransactionType
    status: TransactionStatus = TransactionStatus.pending
    payee: Optional[str] = Field(default=None, max_length=100)
    currency: str = Field(default="GBP", max_length=3)
    exchange_rate: Optional[Decimal] = None
    note: Optional[str] = None
    # For refunds: set to the original expense's id.
    # For transfers: set automatically by the transfer endpoint.
    parent_transaction_id: Optional[uuid.UUID] = None
    promotion_id: Optional[uuid.UUID] = None
    splits: list[TransactionSplitCreate] = Field(default_factory=list)


class TransactionResponse(BaseModel):
    """
    Response body for all transaction endpoints.

    amount and exchange_rate are serialised as strings (not JSON numbers)
    to avoid IEEE 754 precision loss on the JavaScript client side.

    category_name and category_icon are denormalised from the Category row
    so the client can display the category without a separate lookup request.
    They are populated by the router — not read from the Transaction ORM object
    directly (which is why we build a dict in the router rather than returning
    the ORM object straight to Pydantic).
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    account_id: uuid.UUID
    category_id: Optional[uuid.UUID]
    schedule_id: Optional[uuid.UUID]
    promotion_id: Optional[uuid.UUID]
    parent_transaction_id: Optional[uuid.UUID]
    date: date_
    payee: Optional[str]
    amount: Decimal
    currency: str
    exchange_rate: Optional[Decimal]
    transaction_type: str
    status: str
    note: Optional[str]
    created_at: datetime
    # Denormalised from Category — populated by the router helper
    # Nullable for transfers which don't require a category
    category_name: Optional[str]
    category_icon: Optional[str]
    is_split: bool = False
    splits: list[TransactionSplitResponse] = Field(default_factory=list)
    dedup_hash: Optional[str] = None
    external_id: Optional[str] = None

    @field_serializer("amount")
    def serialize_amount(self, value: Decimal) -> str:
        """Return amount as a string with exactly 2 decimal places."""
        return str(value.quantize(Decimal("0.01")))

    @field_serializer("exchange_rate")
    def serialize_exchange_rate(self, value: Optional[Decimal]) -> Optional[str]:
        """Return exchange_rate as a string, or null if not set."""
        if value is None:
            return None
        return str(value)


class TransactionUpdate(BaseModel):
    """
    Request body for PUT /api/v1/transactions/{id}.

    All fields are Optional — partial update pattern (exclude_unset=True).
    Cannot change user_id or schedule_id via this endpoint.
    """

    account_id: Optional[uuid.UUID] = None
    category_id: Optional[uuid.UUID] = None
    date: Optional[date_] = None
    # ge=0: see TransactionCreate.amount — a positive magnitude always,
    # regardless of transaction_type.
    amount: Optional[Decimal] = Field(default=None, ge=0)
    transaction_type: Optional[TransactionType] = None
    status: Optional[TransactionStatus] = None
    payee: Optional[str] = Field(default=None, max_length=100)
    currency: Optional[str] = Field(default=None, max_length=3)
    exchange_rate: Optional[Decimal] = None
    note: Optional[str] = None
    parent_transaction_id: Optional[uuid.UUID] = None
    promotion_id: Optional[uuid.UUID] = None
    splits: Optional[list[TransactionSplitCreate]] = None


class CurrencyAmount(BaseModel):
    """A single currency's aggregated amount."""

    currency: str
    amount: Decimal

    @field_serializer("amount")
    def serialize_amount(self, value: Decimal) -> str:
        return str(value.quantize(Decimal("0.01")))


class TransactionTotals(BaseModel):
    """Aggregated totals by transaction type, per currency."""

    expenses: list[CurrencyAmount]
    income: list[CurrencyAmount]
    transfers: list[CurrencyAmount]
    net: list[CurrencyAmount]


class PaginatedTransactions(BaseModel):
    """Paginated envelope for GET /api/v1/transactions."""

    items: list[TransactionResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
    totals: TransactionTotals


class TransferCreate(BaseModel):
    """
    Request body for POST /api/v1/transactions/transfer.

    A transfer moves money between two of the user's own accounts.
    The router creates two Transaction rows:
      - Debit: from_account_id, transaction_type=transfer (money leaves)
      - Credit: to_account_id, transaction_type=transfer (money arrives)
    Both rows share the same date, amount, and currency. No category is assigned.
    The credit row links to the debit via parent_transaction_id.
    """

    from_account_id: uuid.UUID
    to_account_id: uuid.UUID
    date: date_
    # ge=0: see TransactionCreate.amount.
    amount: Decimal = Field(..., ge=0)
    currency: str = Field(default="GBP", max_length=3)
    note: Optional[str] = None


class ConvertToTransferRequest(BaseModel):
    """
    Request body for POST /api/v1/transactions/{id}/convert-to-transfer.

    Fixes a mis-imported CSV row (e.g. a bank transfer that was categorised
    as a plain expense/income) without losing the row's history — the
    existing transaction is mutated in place into one leg of the transfer,
    keeping its id, dedup_hash, and external_id. Only other_account_id is
    needed: direction (debit vs credit) is inferred from the transaction's
    current type.
    """

    other_account_id: uuid.UUID
