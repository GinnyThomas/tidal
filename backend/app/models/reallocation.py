# app/models/reallocation.py
#
# Purpose: SQLAlchemy model for the reallocations table.
#
# A Reallocation records a deliberate mid-month budget adjustment — moving
# planned spend from one category to another with a mandatory reason.
#
# Example: "Moving £100 from Groceries to Entertainment — birthday dinner."
#
# Key design decisions:
#
#   Immutable record (NO deleted_at, NO updated_at):
#     Reallocations are a permanent audit trail. The user must always be able
#     to see every budget adjustment they made and why. Unlike other entities,
#     these records can never be deleted or modified — not even soft-deleted.
#     If a user made a mistake, they must create a correcting reallocation
#     (e.g. move the amount back). This keeps the history honest.
#
#   month + year instead of a date:
#     A reallocation applies to a budget period (a whole month), not a
#     specific date. Storing month+year directly makes the plan service query
#     straightforward — no date range arithmetic needed.
#
#   reason is Text not String:
#     Reasons should be as long as needed. We enforce non-empty at the schema
#     layer (validator), not here — the DB has no minimum-length constraint.
#
#   Two FK columns to categories (from/to):
#     Both reference the same categories table. SQLAlchemy's ForeignKey()
#     handles this cleanly with two separate columns.

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Reallocation(Base):
    """Permanent audit record of a budget adjustment between two categories."""

    __tablename__ = "reallocations"

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

    # --- Category links ---
    # from_category_id: the category losing planned budget
    from_category_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("categories.id"),
        nullable=False,
    )

    # to_category_id: the category gaining planned budget
    to_category_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("categories.id"),
        nullable=False,
    )

    # --- Amount ---
    # NUMERIC(12,2): same precision as all other financial amounts in this project.
    amount: Mapped[float] = mapped_column(
        Numeric(precision=12, scale=2),
        nullable=False,
    )

    # ISO 4217 currency code. Defaults to GBP.
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="GBP")

    # --- Reason ---
    # Mandatory — every adjustment must be explained. Enforced non-empty at the
    # schema validation layer (ReallocationCreate validator), not the DB layer.
    reason: Mapped[str] = mapped_column(Text, nullable=False)

    # --- Budget period ---
    # month: calendar month (1–12) this reallocation applies to
    month: Mapped[int] = mapped_column(Integer, nullable=False)

    # year: calendar year (e.g. 2026) this reallocation applies to
    year: Mapped[int] = mapped_column(Integer, nullable=False)

    # --- Timestamp ---
    # created_at only — no updated_at because reallocations are immutable.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    def __repr__(self) -> str:
        return (
            f"<Reallocation id={self.id} "
            f"from={self.from_category_id} to={self.to_category_id} "
            f"amount={self.amount} {self.year}-{self.month:02d}>"
        )
