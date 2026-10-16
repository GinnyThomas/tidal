# tests/test_password_reset.py
#
# Purpose: Tests for the "forgot password" flow.
#
#   POST /api/v1/auth/forgot-password  → always 202; emails a reset link if the account exists
#   POST /api/v1/auth/reset-password   → swaps a valid, unexpired, unused token for a new password
#
# Email is never really sent in tests: the `sent_emails` fixture replaces
# app.services.email.send_email with a fake that records each call. We pull
# the raw token out of the recorded link, exactly as a user would click it.

import re

import pytest

from app.config import settings
from app.services import email as email_service

FORGOT_URL = "/api/v1/auth/forgot-password"
RESET_URL = "/api/v1/auth/reset-password"
LOGIN_URL = "/api/v1/auth/login"


@pytest.fixture
def sent_emails(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, str]]:
    """Captures emails instead of sending them. Each entry: {to, subject, html}."""
    outbox: list[dict[str, str]] = []

    def fake_send_email(to: str, subject: str, html: str) -> None:
        outbox.append({"to": to, "subject": subject, "html": html})

    monkeypatch.setattr(email_service, "send_email", fake_send_email)
    return outbox


def _register(test_client, email: str = "ginny@example.com", password: str = "oldpassword") -> None:
    response = test_client.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert response.status_code == 201


def _token_from(sent_email: dict[str, str]) -> str:
    match = re.search(r"reset-password\?token=([A-Za-z0-9_\-]+)", sent_email["html"])
    assert match is not None, "reset link not found in email body"
    return match.group(1)


def _request_reset_token(test_client, sent_emails, email: str = "ginny@example.com") -> str:
    response = test_client.post(FORGOT_URL, json={"email": email})
    assert response.status_code == 202
    return _token_from(sent_emails[-1])


# =============================================================================
# POST /forgot-password
# =============================================================================


def test_forgot_password_for_existing_user_returns_202_and_sends_link(test_client, sent_emails) -> None:
    _register(test_client)

    response = test_client.post(FORGOT_URL, json={"email": "ginny@example.com"})

    assert response.status_code == 202
    assert len(sent_emails) == 1
    assert sent_emails[0]["to"] == "ginny@example.com"
    # The link must point at the frontend, not the API.
    assert f"{settings.FRONTEND_URL}/reset-password?token=" in sent_emails[0]["html"]


def test_forgot_password_for_unknown_email_returns_same_response_and_sends_nothing(
    test_client, sent_emails
) -> None:
    """Anti-enumeration: an unknown email is indistinguishable from a known one."""
    _register(test_client)
    known = test_client.post(FORGOT_URL, json={"email": "ginny@example.com"})

    unknown = test_client.post(FORGOT_URL, json={"email": "nobody@example.com"})

    assert unknown.status_code == known.status_code == 202
    assert unknown.json() == known.json()
    assert len(sent_emails) == 1  # only the known account got an email


def test_forgot_password_is_case_insensitive(test_client, sent_emails) -> None:
    _register(test_client)

    test_client.post(FORGOT_URL, json={"email": "GINNY@Example.com"})

    assert len(sent_emails) == 1
    assert sent_emails[0]["to"] == "ginny@example.com"


def test_forgot_password_with_invalid_email_returns_422(test_client, sent_emails) -> None:
    response = test_client.post(FORGOT_URL, json={"email": "not-an-email"})

    assert response.status_code == 422


def test_forgot_password_token_is_not_stored_in_plain_text(test_client, sent_emails) -> None:
    """Only a hash of the token is persisted — a DB leak must not yield usable links."""
    from app.database import get_db
    from app.main import app
    from app.models.password_reset_token import PasswordResetToken

    _register(test_client)
    raw_token = _request_reset_token(test_client, sent_emails)

    db = next(app.dependency_overrides[get_db]())
    stored = db.query(PasswordResetToken).one()
    assert stored.token_hash != raw_token
    assert raw_token not in stored.token_hash


# =============================================================================
# POST /reset-password
# =============================================================================


def test_reset_password_with_valid_token_changes_password(test_client, sent_emails) -> None:
    _register(test_client)
    token = _request_reset_token(test_client, sent_emails)

    response = test_client.post(RESET_URL, json={"token": token, "new_password": "brandnewpassword"})

    assert response.status_code == 204
    new_login = test_client.post(LOGIN_URL, json={"email": "ginny@example.com", "password": "brandnewpassword"})
    assert new_login.status_code == 200
    old_login = test_client.post(LOGIN_URL, json={"email": "ginny@example.com", "password": "oldpassword"})
    assert old_login.status_code == 401


def test_reset_password_token_is_single_use(test_client, sent_emails) -> None:
    _register(test_client)
    token = _request_reset_token(test_client, sent_emails)
    first = test_client.post(RESET_URL, json={"token": token, "new_password": "brandnewpassword"})
    assert first.status_code == 204

    second = test_client.post(RESET_URL, json={"token": token, "new_password": "anotherpassword"})

    assert second.status_code == 400
    login = test_client.post(LOGIN_URL, json={"email": "ginny@example.com", "password": "brandnewpassword"})
    assert login.status_code == 200


def test_reset_password_with_unknown_token_returns_400(test_client, sent_emails) -> None:
    _register(test_client)

    response = test_client.post(RESET_URL, json={"token": "made-up-token", "new_password": "brandnewpassword"})

    assert response.status_code == 400
    assert response.json()["detail"] == "This reset link is invalid or has expired."


def test_reset_password_with_expired_token_returns_400(
    test_client, sent_emails, monkeypatch: pytest.MonkeyPatch
) -> None:
    _register(test_client)
    # A negative lifetime means the token is already expired when it's created.
    monkeypatch.setattr(settings, "PASSWORD_RESET_EXPIRE_MINUTES", -1)
    token = _request_reset_token(test_client, sent_emails)

    response = test_client.post(RESET_URL, json={"token": token, "new_password": "brandnewpassword"})

    assert response.status_code == 400
    login = test_client.post(LOGIN_URL, json={"email": "ginny@example.com", "password": "oldpassword"})
    assert login.status_code == 200


def test_reset_password_invalidates_other_outstanding_tokens(test_client, sent_emails) -> None:
    """Requesting twice then using one link must kill the other link too."""
    _register(test_client)
    first_token = _request_reset_token(test_client, sent_emails)
    second_token = _request_reset_token(test_client, sent_emails)

    used = test_client.post(RESET_URL, json={"token": second_token, "new_password": "brandnewpassword"})
    assert used.status_code == 204

    stale = test_client.post(RESET_URL, json={"token": first_token, "new_password": "attackerpassword"})
    assert stale.status_code == 400


def test_reset_password_with_short_password_returns_422(test_client, sent_emails) -> None:
    _register(test_client)
    token = _request_reset_token(test_client, sent_emails)

    response = test_client.post(RESET_URL, json={"token": token, "new_password": "short"})

    assert response.status_code == 422
    # The token wasn't consumed by the rejected request.
    retry = test_client.post(RESET_URL, json={"token": token, "new_password": "brandnewpassword"})
    assert retry.status_code == 204
