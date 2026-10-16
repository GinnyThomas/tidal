# app/services/password_reset.py
#
# Purpose: Business logic for the forgot-password flow — issuing reset tokens,
#          building the email, and redeeming a token for a new password.
#
# Token lifecycle:
#   1. request_password_reset() runs as a background task (after the response,
#      so known and unknown emails respond identically fast). For an active
#      account it replaces any previous token with a new one — 32 random bytes
#      (secrets.token_urlsafe), stored only as a SHA-256 hash — and emails it.
#   2. reset_password() atomically claims the token (unused + unexpired →
#      used), sets the new password, and bumps user.token_version so every
#      JWT issued before the reset stops working.

import hashlib
import html
import logging
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, update
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.models.password_reset_token import PasswordResetToken
from app.models.user import User
from app.services import email as email_service
from app.services.auth import hash_password

logger = logging.getLogger(__name__)


def hash_token(raw_token: str) -> str:
    """SHA-256 hex digest of a raw token — what we store and look up by."""
    return hashlib.sha256(raw_token.encode()).hexdigest()


def create_reset_token(user: User, db: Session) -> str:
    """
    Replaces any existing reset token for `user` with a new one; returns the raw token.

    Deleting the old rows keeps the table at one row per user (no unbounded
    growth from repeated requests) and means only the newest emailed link works.
    """
    db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user.id).delete(
        synchronize_session=False
    )
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
    link = html.escape(f"{settings.frontend_base_url}/reset-password?token={raw_token}")
    minutes = settings.PASSWORD_RESET_EXPIRE_MINUTES
    body = (
        "<p>Someone asked to reset the password for your Tidal account.</p>"
        f'<p><a href="{link}">Reset your password</a></p>'
        f"<p>This link expires in {minutes} minutes and can only be used once.</p>"
        "<p>If this wasn't you, you can ignore this email — your password won't change.</p>"
    )
    return "Reset your Tidal password", body


def request_password_reset(email: str, session_factory: sessionmaker[Session]) -> None:
    """
    Background task: if `email` belongs to an active account, issue a token and email the link.

    Opens its own session (the request's session is closed by now). Errors are
    logged, not raised — the response has already been sent.
    """
    db = session_factory()
    try:
        user = (
            db.query(User)
            .filter(func.lower(User.email) == email.lower(), User.deleted_at.is_(None))
            .first()
        )
        if user is None:
            return
        raw_token = create_reset_token(user, db)
        subject, body = build_reset_email(raw_token)
        email_service.send_email(user.email, subject, body)
    except Exception:
        logger.exception("Password reset request failed")
    finally:
        db.close()


def reset_password(raw_token: str, new_password: str, db: Session) -> bool:
    """
    Redeems a reset token. Returns False if the token is unknown, used or expired.

    Claiming is ONE statement — UPDATE ... WHERE used_at IS NULL ... RETURNING.
    A separate SELECT-then-UPDATE would let two concurrent requests both see
    the token as unused. In PostgreSQL the second UPDATE waits on the first's
    row lock, then re-checks `used_at IS NULL`, finds it set, and matches 0 rows.

    The expiry check is in SQL too: SQLite (tests) returns naive datetimes, so
    comparing in Python would mix naive and aware values.
    """
    now = datetime.now(timezone.utc)
    user_id = db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.token_hash == hash_token(raw_token),
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > now,
        )
        .values(used_at=now)
        .returning(PasswordResetToken.user_id)
    ).scalar_one_or_none()
    if user_id is None:
        db.rollback()
        return False

    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if user is None:
        db.rollback()
        return False

    user.password_hash = hash_password(new_password)
    # Revoke every JWT issued before now (see User.token_version).
    user.token_version += 1
    db.commit()
    return True
