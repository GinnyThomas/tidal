# app/models/budget.py
#
# Purpose: SQLAlchemy models for the budgets and budget_overrides tables.
#
# A Budget defines a monthly spending target for a category — the variable/
# discretionary side of planning. Schedules handle fixed recurring
# transactions (rent, subscriptions); budgets handle variable spending
# targets (groceries, eating out, clothing).
#
# Each budget covers one category for one year. The default_amount is the
# monthly spending target. BudgetOverride allows per-month adjustments
# (e.g. more budget for food in December).
#
# Budget amounts and schedule amounts are additive in the plan view — a
# category can have both a schedule (fixed) and a budget (variable) and
# its planned total is the sum of both.
#
# Unlike transactions and schedules, budgets use hard delete — there is no
# deleted_at column. Users should be able to fully remove a budget without
# leaving ghost data.

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Budget(Base):
    """Annual spending target for a category — one budget per category per year."""

    __tablename__ = "budgets"
    __table_args__ = (
        # Only one budget per user per category per year.
        UniqueConstraint(
            "user_id", "category_id", "year",
            name="uq_budget_user_category_year",
        ),
    )

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

    # --- Category link ---
    category_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("categories.id"),
        nullable=False,
    )

    # --- Budget fields ---
    # year: the calendar year this budget applies to.
    year: Mapped[int] = mapped_column(Integer, nullable=False)

    # default_amount: the monthly spending target used for any month that
    # doesn't have a BudgetOverride row.
    default_amount: Mapped[Decimal] = mapped_column(
        Numeric(precision=12, scale=2),
        nullable=False,
    )

    # ISO 4217 currency code. Defaults to GBP.
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="GBP")

    # Optional grouping label for filtering budgets in the plan view.
    # e.g. "UK", "España" — allows users to view planned spending for a
    # specific context without seeing unrelated budgets.
    group: Mapped[str | None] = mapped_column(String(50), nullable=True, default=None)

    # --- Notes ---
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

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

    # --- Relationships ---
    # cascade="all, delete-orphan" ensures overrides are removed when the
    # budget is hard-deleted.
    overrides: Mapped[list["BudgetOverride"]] = relationship(
        "BudgetOverride",
        back_populates="budget",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return (
            f"<Budget id={self.id} year={self.year} "
            f"default_amount={self.default_amount}>"
        )


class BudgetOverride(Base):
    """Month-specific override for a budget's default amount."""

    __tablename__ = "budget_overrides"
    __table_args__ = (
        # Only one override per month per budget.
        UniqueConstraint(
            "budget_id", "month",
            name="uq_budget_override_budget_month",
        ),
    )

    # --- Primary key ---
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    # --- Budget link ---
    # ondelete="CASCADE": when a budget is hard-deleted, its overrides go too.
    budget_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("budgets.id", ondelete="CASCADE"),
        nullable=False,
    )

    # --- Override fields ---
    # month: 1-12 (January through December).
    month: Mapped[int] = mapped_column(Integer, nullable=False)

    # amount: the spending target for this specific month, replacing the
    # budget's default_amount.
    amount: Mapped[Decimal] = mapped_column(
        Numeric(precision=12, scale=2),
        nullable=False,
    )

    # --- Relationships ---
    budget: Mapped["Budget"] = relationship(
        "Budget",
        back_populates="overrides",
    )

    def __repr__(self) -> str:
        return (
            f"<BudgetOverride id={self.id} month={self.month} "
            f"amount={self.amount}>"
        )
