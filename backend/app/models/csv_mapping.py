# app/models/csv_mapping.py
#
# Purpose: SQLAlchemy model for the csv_mappings table.
#
# Stores a user's saved column→field mapping for a specific account.
# One saved mapping per (user, account) pair — enforced by unique constraint.
# The mapping_json field holds the full column mapping as a JSON object,
# matching the frontend's MappingConfig type.

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, JSON, String, Uuid, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CsvMapping(Base):
    """A saved CSV column mapping for one user's account."""

    __tablename__ = "csv_mappings"
    __table_args__ = (
        UniqueConstraint("user_id", "account_id", name="uq_csv_mappings_user_account"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    account_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Human-readable label, e.g. "Barclays UK" or "Custom mapping".
    name: Mapped[str] = mapped_column(String(100), nullable=False)

    # The column→field map serialised as JSON.
    # Example: {"date_column": "Date", "amount_column": "Amount", ...}
    mapping_json: Mapped[dict] = mapped_column(JSON, nullable=False)

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

    def __repr__(self) -> str:
        return f"<CsvMapping id={self.id} account_id={self.account_id} name={self.name!r}>"
