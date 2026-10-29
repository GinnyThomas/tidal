# app/services/email.py
#
# Purpose: Send transactional email (currently only password reset links).
#
# Why Resend over SMTP?
#   Railway blocks outbound SMTP on its lower plans, so we use Resend's HTTP
#   API instead — one POST with httpx (already a dependency), no SDK needed.
#
# Why log instead of send when RESEND_API_KEY is empty?
#   Local dev and tests then need no Resend account: the email (including the
#   reset link) appears in the uvicorn console and you can click it from there.
#   Only when the frontend is localhost, though — on a deployed host a missing
#   key is a misconfiguration, and the body holds a live reset link that must
#   never land in Railway's logs. There we log an error without the body.
#
# Errors are logged, never raised: send_email runs as a FastAPI background
# task AFTER the response has gone out, so there is no client to report to —
# and the forgot-password response must look identical either way.

import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"
REQUEST_TIMEOUT_SECONDS = 10.0


def send_email(to: str, subject: str, html: str) -> None:
    """Sends an HTML email via Resend, or logs it when no API key is configured."""
    if not settings.RESEND_API_KEY:
        if settings.frontend_is_local:
            logger.info("RESEND_API_KEY not set — email not sent.\nTo: %s\nSubject: %s\n%s", to, subject, html)
        else:
            logger.error("RESEND_API_KEY not set — email to %s (%r) was NOT sent.", to, subject)
        return

    try:
        response = httpx.post(
            RESEND_API_URL,
            headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
            json={"from": settings.EMAIL_FROM, "to": [to], "subject": subject, "html": html},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        # Without a verified domain, Resend rejects (403) any recipient other
        # than the account owner — that will show up here.
        detail = exc.response.text if isinstance(exc, httpx.HTTPStatusError) else str(exc)
        logger.error("Failed to send email to %s: %s", to, detail)
        return

    # The email has gone out by now, so an unreadable body must not raise:
    # the caller would log a failure for an email that was actually sent.
    logger.info("Email %r sent to %s (Resend id %s)", subject, to, _resend_id(response))


def _resend_id(response: httpx.Response) -> str | None:
    """Resend's id for the sent email (searchable in its dashboard), or None if the body isn't readable."""
    try:
        return response.json().get("id")
    except (ValueError, AttributeError):
        return None
