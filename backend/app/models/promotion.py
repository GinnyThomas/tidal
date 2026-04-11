# app/models/promotion.py
#
# Purpose: SQLAlchemy model for the promotions table.
#
# A Promotion tracks a 0% interest or deferred interest deal — balance
# transfers, BNPL (buy now pay later), or similar. The key insight is
# knowing how many days remain and what monthly payment is needed to
# clear the balance before the promotional period ends.
#
# Unlike transactions and schedules, promotions use hard delete — no
# deleted_at column.

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Promotion(Base):
    """Tracks a 0% interest or deferred interest promotional deal."""

    __tablename__ = "promotions"

    # --- Primary key ---
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )

    # --- Ownership ---
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True,
    )

    # --- Optional account link ---
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("accounts.id"), nullable=True,
    )

    # --- Descriptive fields ---
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    promotion_type: Mapped[str] = mapped_column(String(20), nullable=False)

    # --- Financial fields ---
    original_balance: Mapped[Decimal] = mapped_column(
        Numeric(precision=12, scale=2), nullable=False,
    )
    interest_rate: Mapped[Decimal] = mapped_column(
        Numeric(precision=5, scale=2), nullable=False, default=Decimal("0.00"),
    )
    minimum_monthly_payment: Mapped[Decimal | None] = mapped_column(
        Numeric(precision=12, scale=2), nullable=True,
    )

    # --- Date range ---
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)

    # --- Status ---
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # --- Notes ---
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # --- Timestamps ---
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    def __repr__(self) -> str:
        return f"<Promotion id={self.id} name={self.name!r} type={self.promotion_type!r}>"
