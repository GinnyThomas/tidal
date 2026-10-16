# app/services/password_reset.py
#
# Purpose: Business logic for the forgot-password flow — issuing reset tokens,
#          building the email, and redeeming a token for a new password.
#
# Token lifecycle:
#   1. create_reset_token(): generate 32 random bytes (secrets.token_urlsafe),
#      store only their SHA-256 hash, return the raw token for the email link.
#   2. reset_password(): hash the submitted token, find a row that is unused
#      and unexpired, set the new password, and mark every outstanding token
#      for that user as used — so an older link in the inbox can't be replayed.

import hashlib
import html
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.config import settings
from app.models.password_reset_token import PasswordResetToken
from app.models.user import User
from app.services.auth import hash_password


def hash_token(raw_token: str) -> str:
    """SHA-256 hex digest of a raw token — what we store and look up by."""
    return hashlib.sha256(raw_token.encode()).hexdigest()


def create_reset_token(user: User, db: Session) -> str:
    """Persists a hashed reset token for `user` and returns the raw token."""
    raw_token = secrets.token_urlsafe(32)
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=hash_token(raw_token),
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.PASSWORD_RESET_EXPIRE_MINUTES),
        )
    )
    db.commit()
    return raw_token


def build_reset_email(raw_token: str) -> tuple[str, str]:
    """Returns (subject, html) for the reset email. The link points at the frontend."""
    link = html.escape(f"{settings.FRONTEND_URL}/reset-password?token={raw_token}")
    minutes = settings.PASSWORD_RESET_EXPIRE_MINUTES
    body = (
        "<p>Someone asked to reset the password for your Tidal account.</p>"
        f'<p><a href="{link}">Reset your password</a></p>'
        f"<p>This link expires in {minutes} minutes and can only be used once.</p>"
        "<p>If this wasn't you, you can ignore this email — your password won't change.</p>"
    )
    return "Reset your Tidal password", body


def reset_password(raw_token: str, new_password: str, db: Session) -> bool:
    """
    Redeems a reset token. Returns False if the token is unknown, used or expired.

    The expiry check happens in SQL (expires_at > now) rather than in Python:
    SQLite (tests) hands back naive datetimes, so comparing in Python would
    mix naive and aware values.
    """
    now = datetime.now(timezone.utc)
    token = (
        db.query(PasswordResetToken)
        .filter(
            PasswordResetToken.token_hash == hash_token(raw_token),
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > now,
        )
        .first()
    )
    if token is None:
        return False

    user = db.query(User).filter(User.id == token.user_id, User.deleted_at.is_(None)).first()
    if user is None:
        return False

    user.password_hash = hash_password(new_password)

    # Consume this token AND any other outstanding ones for the same user.
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used_at.is_(None),
    ).update({PasswordResetToken.used_at: now}, synchronize_session=False)

    db.commit()
    return True
