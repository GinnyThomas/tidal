# app/models/account.py
#
# Purpose: SQLAlchemy model for the accounts table.
#
# An Account is where money lives — a bank account, credit card, cash wallet, etc.
# Users can have multiple accounts in different currencies. Every transaction
# is associated with an account.
#
# Design decisions:
#   - account_type is a plain String rather than a database ENUM. We validate
#     the allowed values in the Pydantic schema instead. Using a DB ENUM would
#     require a migration every time we add a new type; String is more flexible.
#   - current_balance uses NUMERIC(12,2) not FLOAT. Floats cannot represent
#     decimal fractions exactly (0.1 + 0.2 != 0.3 in IEEE 754 arithmetic).
#     NUMERIC stores exact decimal values — essential for financial data.
#   - is_manual=True by default because all accounts created via the API are
#     manually entered. A future bank-sync integration would set is_manual=False.
#   - Soft delete via deleted_at follows the same pattern as User.

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Account(Base):
    """Represents a financial account belonging to a user."""

    __tablename__ = "accounts"

    # --- Primary key ---
    # Same UUID pattern as User — unguessable, no coordination needed.
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    # --- Ownership ---
    #
    # Every account belongs to exactly one user.
    # ForeignKey("users.id") creates a database-level constraint: you cannot
    # insert an account row with a user_id that doesn't exist in the users table.
    # index=True: we frequently query "all accounts for user X", so an index on
    # user_id is essential for performance.
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )

    # --- Identity ---
    name: Mapped[str] = mapped_column(String(100), nullable=False)

    # Valid values enforced at the schema layer: checking, savings, credit_card,
    # cash, mortgage, loan. The DB column is just String(20) for flexibility.
    account_type: Mapped[str] = mapped_column(String(20), nullable=False)

    # --- Financial properties ---
    #
    # ISO 4217 currency code (GBP, EUR, USD...).
    # Accounts can hold different currencies — a user might have a GBP current
    # account and a EUR savings account simultaneously.
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="GBP")

    # NUMERIC(12,2): supports balances up to ±9,999,999,999.99.
    # SQLAlchemy's Numeric type maps to NUMERIC in PostgreSQL (exact decimal)
    # and to a numeric-affinity type in SQLite for tests.
    # Python representation: Decimal objects (never float).
    current_balance: Mapped[Decimal] = mapped_column(
        Numeric(precision=12, scale=2),
        nullable=False,
        default=Decimal("0"),
    )

    # is_manual=True means the user enters transactions by hand.
    # is_manual=False would be reserved for a future bank-sync integration.
    # All accounts created via this API are manual.
    is_manual: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # --- Optional metadata ---
    # The name of the bank or institution, e.g. "Nationwide", "HSBC".
    institution: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # is_active allows accounts to be "archived" without being deleted.
    # Inactive accounts don't appear in the main view but are preserved for history.
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Free-text note the user can attach to an account.
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
    # None = active. A datetime = logically deleted.
    # Queries that list accounts must filter: WHERE deleted_at IS NULL.
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )

    def __repr__(self) -> str:
        return f"<Account id={self.id} name={self.name!r} type={self.account_type!r}>"
