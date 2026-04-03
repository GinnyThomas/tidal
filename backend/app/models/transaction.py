# app/models/transaction.py
#
# Purpose: SQLAlchemy model for the transactions table.
#
# A Transaction is a financial event — money moving into, out of, or between
# accounts. Every transaction belongs to one account and one category.
#
# Four types (transaction_type column):
#   expense    — money leaving an account (e.g. grocery shop)
#   income     — money arriving in an account (e.g. salary)
#   transfer   — money moving between two of the user's accounts
#                Transfers are stored as TWO linked rows (debit + credit)
#                connected via parent_transaction_id
#   refund     — reversal of a previous expense, linked to the original
#                transaction via parent_transaction_id
#
# Three statuses (status column):
#   pending    — expected but not yet settled (e.g. a scheduled payment)
#   cleared    — settled and visible on the bank statement
#   reconciled — cleared and cross-checked against an official statement
#
# Only cleared and reconciled transactions count toward budget "actual spend".
# Pending transactions are intentionally excluded from budget calculations
# (per CLAUDE.md) so that expected future spending doesn't corrupt the view.
#
# schedule_id:
#   Nullable UUID column with NO foreign key constraint.
#   The schedules table doesn't exist yet — the FK will be added in Phase 5
#   when schedules are implemented. Leaving out the FK now avoids a migration
#   dependency on a table that doesn't exist.
#
# parent_transaction_id:
#   Self-referential FK — same pattern as categories.parent_category_id.
#   Used for two purposes:
#     1. Transfer debit → credit link (credit.parent = debit.id)
#     2. Refund → original expense link (refund.parent = expense.id)

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Transaction(Base):
    """Represents a financial event — expense, income, transfer leg, or refund."""

    __tablename__ = "transactions"

    # --- Primary key ---
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    # --- Ownership ---
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )

    # --- Account link ---
    # Which account this transaction affects. Indexed because we frequently
    # query "all transactions for account X".
    account_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("accounts.id"),
        nullable=False,
        index=True,
    )

    # --- Schedule link ---
    # References the schedule that generated this transaction, if any.
    # Nullable — most transactions are entered manually without a schedule.
    schedule_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("schedules.id"),
        nullable=True,
    )

    # --- Self-referential link ---
    # For transfers: credit.parent_transaction_id = debit.id
    # For refunds: refund.parent_transaction_id = original_expense.id
    parent_transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("transactions.id"),
        nullable=True,
    )

    # --- Category link ---
    category_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("categories.id"),
        nullable=False,
    )

    # --- Core fields ---
    # date is the transaction date (what the user sees), not created_at (when
    # the row was created). A user might enter a past transaction today.
    date: Mapped[date] = mapped_column(Date, nullable=False)

    payee: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # NUMERIC(12,2): same precision as account current_balance.
    # Serialised as a string in API responses to prevent float precision loss.
    amount: Mapped[Decimal] = mapped_column(
        Numeric(precision=12, scale=2),
        nullable=False,
    )

    # ISO 4217 currency code. Defaults to GBP — change at transaction level
    # for foreign-currency purchases.
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="GBP")

    # exchange_rate: used when currency != account.currency.
    # NUMERIC(10,6): supports rates like 1.234567.
    exchange_rate: Mapped[Decimal | None] = mapped_column(
        Numeric(precision=10, scale=6),
        nullable=True,
    )

    # --- Classification ---
    # Values: expense, income, transfer, refund.
    # Validated at the schema layer via TransactionType enum.
    transaction_type: Mapped[str] = mapped_column(String(20), nullable=False)

    # Values: pending, cleared, reconciled.
    # Only cleared + reconciled count toward budget actual spend.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")

    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # --- Timestamps ---
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # --- Soft delete ---
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )

    def __repr__(self) -> str:
        return (
            f"<Transaction id={self.id} type={self.transaction_type!r} "
            f"amount={self.amount} status={self.status!r}>"
        )
