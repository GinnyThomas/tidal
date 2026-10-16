# tests/test_email.py
#
# Purpose: Tests for the Resend email sender in app/services/email.py.
#
# No real HTTP calls: httpx.post is replaced with a fake that records the
# request (or raises, to simulate Resend being down).

import logging

import httpx
import pytest

from app.config import settings
from app.services import email as email_service


@pytest.fixture
def fake_post(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    calls: list[dict] = []

    def _fake_post(url: str, **kwargs: object) -> httpx.Response:
        calls.append({"url": url, **kwargs})
        return httpx.Response(200, json={"id": "email-id"}, request=httpx.Request("POST", url))

    monkeypatch.setattr(email_service.httpx, "post", _fake_post)
    return calls


def test_send_email_without_api_key_logs_instead_of_sending(
    fake_post, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Local dev and tests need no Resend account — the email is logged."""
    monkeypatch.setattr(settings, "RESEND_API_KEY", "")

    with caplog.at_level(logging.INFO, logger="app.services.email"):
        email_service.send_email("ginny@example.com", "Hello", "<p>link here</p>")

    assert fake_post == []
    assert "ginny@example.com" in caplog.text
    assert "link here" in caplog.text


def test_send_email_with_api_key_posts_to_resend(fake_post, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "RESEND_API_KEY", "re_test_key")

    email_service.send_email("ginny@example.com", "Hello", "<p>Hi</p>")

    assert len(fake_post) == 1
    call = fake_post[0]
    assert call["url"] == "https://api.resend.com/emails"
    assert call["headers"]["Authorization"] == "Bearer re_test_key"
    assert call["json"] == {
        "from": settings.EMAIL_FROM,
        "to": ["ginny@example.com"],
        "subject": "Hello",
        "html": "<p>Hi</p>",
    }
    assert call["timeout"] > 0


def test_send_email_swallows_and_logs_resend_errors(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Runs as a background task after the response — a failure must log, not raise."""
    monkeypatch.setattr(settings, "RESEND_API_KEY", "re_test_key")

    def _failing_post(url: str, **kwargs: object) -> httpx.Response:
        return httpx.Response(403, json={"message": "domain not verified"}, request=httpx.Request("POST", url))

    monkeypatch.setattr(email_service.httpx, "post", _failing_post)

    with caplog.at_level(logging.ERROR, logger="app.services.email"):
        email_service.send_email("someone@example.com", "Hello", "<p>Hi</p>")

    assert "someone@example.com" in caplog.text
