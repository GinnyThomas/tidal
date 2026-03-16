# app/models/user.py
#
# Purpose: SQLAlchemy model for the users table.
#
# This class defines the database schema for users AND gives us a Python
# object to work with in application code. SQLAlchemy maps the class
# to the database table automatically when we call Base.metadata.create_all().
#
# We use SQLAlchemy 2.x "mapped column" syntax, which adds full type
# annotations. This means our IDE knows the types of model attributes
# and mypy can type-check them — unlike the older Column() approach where
# everything was effectively untyped.

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    """Represents a Tidal user account in the users table."""

    __tablename__ = "users"

    # --- Primary key ---
    #
    # We use UUIDs rather than auto-incrementing integers (1, 2, 3...) for two reasons:
    #   1. Security: integer IDs are guessable. A user could try /users/1, /users/2...
    #      UUIDs are 128-bit random values — practically impossible to guess.
    #   2. Distribution: UUIDs can be generated client-side or across multiple
    #      servers without coordination. Integers require a central counter.
    #
    # Uuid(as_uuid=True): SQLAlchemy returns Python uuid.UUID objects (not strings).
    # We use SQLAlchemy's generic Uuid type (not dialects.postgresql.UUID) so
    # this model works with both PostgreSQL (native UUID type) and SQLite in tests.
    #
    # default=uuid.uuid4: we pass the FUNCTION, not a call to it.
    # uuid.uuid4()  ← called once at class definition — every row gets the same UUID!
    # uuid.uuid4   ← SQLAlchemy calls this fresh for each new row. Correct.
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    # --- Credentials ---
    #
    # unique=True: the database enforces that no two users share an email.
    #   If we try to insert a duplicate, the DB raises an IntegrityError.
    #
    # index=True: creates a B-tree index on email. Without this, a login query
    #   "SELECT * FROM users WHERE email = ?" requires a full table scan — O(n).
    #   With the index, it's O(log n). Essential for any frequently-queried column.
    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        nullable=False,
        index=True,
    )

    # We NEVER store plain-text passwords. Only the bcrypt hash goes here.
    # bcrypt output is always 60 characters, but 255 gives room to grow
    # if we ever switch hashing algorithms without breaking existing rows.
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    # --- Preferences ---
    #
    # ISO 4217 currency code: always 3 uppercase letters (GBP, EUR, USD).
    # Stored as a plain string per CLAUDE.md — no currency-specific DB type needed.
    # nullable=False: the database column must never contain NULL.
    # The Python default ("GBP") means the ORM fills it when not specified,
    # but without nullable=False the database would still accept a raw INSERT
    # of NULL that bypasses the ORM. Both constraints together close that gap.
    default_currency: Mapped[str] = mapped_column(String(3), nullable=False, default="GBP")

    # IANA timezone name e.g. "UTC", "Europe/London", "America/New_York".
    # We store the name (not the UTC offset) because offsets change with DST.
    timezone: Mapped[str] = mapped_column(String(50), nullable=False, default="UTC")

    # --- Timestamps ---
    #
    # DateTime(timezone=True): stores timestamps as TIMESTAMPTZ in PostgreSQL
    # (timestamp with time zone). This is always a best practice — it prevents
    # confusion when data comes from multiple timezones or when servers move regions.
    # We always write UTC; timezone=True is a safety net.
    #
    # Why lambda? Same reason as uuid.uuid4 above: we pass a callable so
    # SQLAlchemy evaluates it at row creation time, not class definition time.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # onupdate: SQLAlchemy calls this callable automatically whenever it
    # issues an UPDATE statement for this row via the ORM. This keeps
    # updated_at accurate without us having to remember to set it manually.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # --- Soft delete ---
    #
    # We never physically DELETE users from the database. Instead we set
    # deleted_at to mark the record as logically deleted. This preserves
    # audit history and makes "undo" possible.
    #
    # None means the user is active. A datetime means they are deleted.
    # All queries that list users should filter: WHERE deleted_at IS NULL.
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )

    def __repr__(self) -> str:
        """Developer-friendly string representation for debugging."""
        return f"<User id={self.id} email={self.email!r}>"
