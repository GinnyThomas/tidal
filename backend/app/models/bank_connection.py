# app/models/bank_connection.py
#
# Purpose: SQLAlchemy models for bank feeds (Open Banking).
#
# bank_connections — one consent the user gave at one bank.
#   Lifecycle:
#     pending → created when the user clicks "Connect"; holds a random
#               `state` that must come back on the bank's redirect. That
#               stops a forged callback attaching someone else's bank
#               session to this user (the OAuth CSRF defence).
#     active  → the callback exchanged the code for a provider session.
#   A consent expires at valid_until (banks cap it, typically 90–180 days);
#   after that the user must reconnect. "expired" is computed, not stored.
#
# bank_account_links — one bank account inside a consent, optionally linked
#   to a Tidal account. Syncing pulls the bank account's transactions into
#   the linked Tidal account. We keep only the last four IBAN digits —
#   enough to recognise the account, not enough to be worth stealing.

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class BankConnection(Base):
    """A user's consent for Tidal to read their accounts at one bank."""

    __tablename__ = "bank_connections"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True,
    )

    # Which BankFeedProvider created this connection, e.g. "enable_banking".
    provider: Mapped[str] = mapped_column(String(30), nullable=False)

    institution_name: Mapped[str] = mapped_column(String(100), nullable=False)
    # ISO 3166-1 alpha-2, e.g. "GB", "ES".
    institution_country: Mapped[str] = mapped_column(String(2), nullable=False)

    # Random CSRF token for the bank redirect. Cleared once used.
    state: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True)

    # Values: pending, active. Validated in the router.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")

    # Provider's session id — set when the consent completes.
    session_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    links: Mapped[list["BankAccountLink"]] = relationship(
        "BankAccountLink", back_populates="connection", cascade="all, delete-orphan",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc),
    )

    def __repr__(self) -> str:
        return f"<BankConnection id={self.id} institution={self.institution_name!r} status={self.status!r}>"


class BankAccountLink(Base):
    """One bank account within a connection, optionally linked to a Tidal account."""

    __tablename__ = "bank_account_links"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)

    connection_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("bank_connections.id", ondelete="CASCADE"), nullable=False, index=True,
    )

    # Denormalised from the connection so every query can scope by user directly.
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True,
    )

    # The Tidal account feed transactions are imported into. NULL = not linked yet.
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True, index=True,
    )

    # Provider's account id (only valid while the session is).
    provider_account_uid: Mapped[str] = mapped_column(String(255), nullable=False)
    # Stable across sessions — for re-linking after a reconnect.
    identification_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)

    name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    iban_last4: Mapped[str | None] = mapped_column(String(4), nullable=True)

    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    connection: Mapped[BankConnection] = relationship("BankConnection", back_populates="links")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc),
    )

    def __repr__(self) -> str:
        return f"<BankAccountLink id={self.id} name={self.name!r} account_id={self.account_id}>"
