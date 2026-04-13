# app/models/opening_balance.py
#
# Purpose: SQLAlchemy model for group opening balances.
#
# A GroupOpeningBalance stores the starting balance for a budget group
# (e.g. "UK", "España") at the beginning of a year. This powers the
# cash flow feature in the Annual View — showing a running balance
# per group across the 12 months.

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class GroupOpeningBalance(Base):
    """Opening balance for a budget group at the start of a year."""

    __tablename__ = "group_opening_balances"
    __table_args__ = (
        UniqueConstraint("user_id", "group", "year", name="uq_opening_balance_user_group_year"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    group: Mapped[str] = mapped_column(String(50), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    opening_balance: Mapped[Decimal] = mapped_column(Numeric(precision=12, scale=2), nullable=False, default=Decimal("0"))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="GBP")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    def __repr__(self) -> str:
        return f"<GroupOpeningBalance group={self.group!r} year={self.year} balance={self.opening_balance}>"
