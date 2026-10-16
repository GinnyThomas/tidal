# app/models/password_reset_token.py
#
# Purpose: One row per "forgot password" request.
#
# Security design:
#   - We store a SHA-256 hash of the token, never the token itself. The raw
#     token only exists in the emailed link. If the database leaked, the
#     hashes couldn't be turned back into working reset links.
#   - Why SHA-256 and not bcrypt (as for passwords)? The token is 32 random
#     bytes — far too much entropy to brute-force, so a slow hash adds nothing.
#     A fast, deterministic hash also lets us look the token up by equality.
#   - expires_at: links die after PASSWORD_RESET_EXPIRE_MINUTES.
#   - used_at: links are single use. Set on success, and on every other
#     outstanding token for the same user at the same time.

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PasswordResetToken(Base):
    """A single-use, expiring password reset token (stored hashed)."""

    __tablename__ = "password_reset_tokens"

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

    # SHA-256 hex digest: always 64 characters. unique + indexed for lookup.
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)

    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # None = still usable. A datetime = consumed (or invalidated).
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    def __repr__(self) -> str:
        return f"<PasswordResetToken id={self.id} user_id={self.user_id}>"
