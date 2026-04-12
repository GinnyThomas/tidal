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
    amount: Decimal = Field(...)
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
    amount: Optional[Decimal] = None
    transaction_type: Optional[TransactionType] = None
    status: Optional[TransactionStatus] = None
    payee: Optional[str] = Field(default=None, max_length=100)
    currency: Optional[str] = Field(default=None, max_length=3)
    exchange_rate: Optional[Decimal] = None
    note: Optional[str] = None
    parent_transaction_id: Optional[uuid.UUID] = None
    promotion_id: Optional[uuid.UUID] = None


class TransferCreate(BaseModel):
    """
    Request body for POST /api/v1/transactions/transfer.

    A transfer moves money between two of the user's own accounts.
    The router creates two Transaction rows:
      - Debit: from_account_id, transaction_type=transfer (money leaves)
      - Credit: to_account_id, transaction_type=transfer (money arrives)
    Both rows share the same category, date, amount, and currency.
    The credit row links to the debit via parent_transaction_id.
    """

    from_account_id: uuid.UUID
    to_account_id: uuid.UUID
    date: date_
    amount: Decimal = Field(...)
    currency: str = Field(default="GBP", max_length=3)
    note: Optional[str] = None
