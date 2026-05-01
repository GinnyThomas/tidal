# app/models/transaction_split.py
#
# Purpose: SQLAlchemy model for the transaction_splits table.
#
# A TransactionSplit allocates a portion of a parent transaction's amount
# to a specific category (and optionally a promotion). Multiple splits
# let users break an Amazon order into Groceries + Electronics + Gifts.
#
# Invariant: the sum of all splits for a transaction must equal the
# transaction's total amount. This is enforced in the router, not the DB.

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Numeric,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class TransactionSplit(Base):
    """One category allocation within a split transaction."""

    __tablename__ = "transaction_splits"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )

    transaction_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("transactions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    category_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("categories.id"), nullable=True,
    )

    promotion_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("promotions.id"), nullable=True,
    )

    amount: Mapped[Decimal] = mapped_column(
        Numeric(precision=12, scale=2), nullable=False,
    )

    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # --- Relationships ---
    transaction: Mapped["Transaction"] = relationship(  # noqa: F821
        "Transaction", back_populates="splits",
    )
    category: Mapped["Category | None"] = relationship(  # noqa: F821
        "Category", foreign_keys=[category_id], lazy="select",
    )
