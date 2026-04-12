# app/models/schedule.py
#
# Purpose: SQLAlchemy model for the schedules table.
#
# A Schedule defines a recurring transaction rule — the "expected" side of
# the plan-vs-actual equation that is central to Tidal's design.
#
# When a schedule fires, it generates a pending Transaction. When the user
# confirms that transaction actually happened, they clear or reconcile it.
# The gap between what schedules predicted and what transactions confirmed
# is where budget insight lives.
#
# Frequency values (stored as strings, validated by ScheduleFrequency enum):
#   daily        — every day
#   weekly       — every N weeks (controlled by `interval`)
#   monthly      — same date each month (controlled by `day_of_month`)
#   every_n_days — every N calendar days (controlled by `interval`)
#   quarterly    — four times a year
#   annually     — once a year
#
# interval field:
#   Defaults to 1. For weekly: interval=2 means "every 2 weeks".
#   For every_n_days: interval=10 means "every 10 days".
#
# day_of_month field:
#   Only meaningful for monthly, quarterly, and annually schedules.
#   Stores the day number (1–31). If null, defaults to the start_date's day.
#
# auto_generate field:
#   When true, the schedule engine automatically creates pending transactions.
#   When false, the schedule is a reminder only — no auto-creation.
#
# active field:
#   Soft-disable a schedule without deleting it. Inactive schedules are
#   excluded from the default list view and will not auto-generate transactions.
#   Different from deleted_at — deleted_at means "user removed this",
#   active=False means "user paused this".

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Schedule(Base):
    """Defines a recurring transaction rule — the planned/expected side of a budget."""

    __tablename__ = "schedules"

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
    # Which account this schedule's generated transactions will affect.
    account_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("accounts.id"),
        nullable=False,
    )

    # --- Category link ---
    category_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("categories.id"),
        nullable=False,
    )

    # --- Descriptive fields ---
    # name: user-facing label for this schedule, e.g. "Monthly rent"
    name: Mapped[str] = mapped_column(String(100), nullable=False)

    # payee: who the money goes to/from, e.g. "Landlord"
    payee: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # --- Amount ---
    # NUMERIC(12,2): same precision as Transaction.amount and Account.current_balance.
    amount: Mapped[Decimal] = mapped_column(
        Numeric(precision=12, scale=2),
        nullable=False,
    )

    # ISO 4217 currency code. Defaults to GBP.
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="GBP")

    # --- Recurrence rules ---
    # Values: daily, weekly, monthly, every_n_days, quarterly, annually
    # Validated at schema layer via ScheduleFrequency enum.
    frequency: Mapped[str] = mapped_column(String(20), nullable=False)

    # interval: multiplier for frequency. Defaults to 1.
    # e.g. frequency=weekly + interval=2 → "every 2 weeks"
    interval: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # day_of_month: for monthly/quarterly/annually, which day to fire on (1–31).
    # If null, the schedule uses the day number from start_date.
    day_of_month: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # --- Date range ---
    # start_date: the first date this schedule is active from.
    start_date: Mapped[date] = mapped_column(Date, nullable=False)

    # end_date: optional. If set, no transactions generated after this date.
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # --- Behaviour flags ---
    # auto_generate: if True, engine creates pending transactions automatically.
    # if False, schedule is a reminder only.
    auto_generate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # active: if False, schedule is paused (no auto-generation, excluded from
    # default list). Different from deleted_at — this is a temporary pause,
    # not a deletion.
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # --- Optional group ---
    # Grouping label for filtering in the plan view (e.g. "UK", "España").
    group: Mapped[str | None] = mapped_column(String(50), nullable=True, default=None)

    # --- Optional note ---
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
            f"<Schedule id={self.id} name={self.name!r} "
            f"frequency={self.frequency!r} active={self.active}>"
        )
