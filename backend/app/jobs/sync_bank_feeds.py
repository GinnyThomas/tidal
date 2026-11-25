# app/jobs/sync_bank_feeds.py
#
# Purpose: The daily bank feed sync. Syncs every linked bank account of every
# user, so nobody has to click "Sync now" on each one.
#
# Run by a Railway cron service (same repo, root directory `backend`):
#   start command:  python -m app.jobs.sync_bank_feeds
#   schedule:       0 6 * * *   (Railway cron is UTC: 06:00 GMT / 07:00 BST)
# It talks to the database directly: there is no HTTP endpoint to protect.
#
# What it does NOT do: refresh. It never asks a provider which banks exist,
# so it never adds or removes connections or accounts; that stays a user
# action ("Refresh from BankSync").
#
# Each account goes through services/bank_feed_sync.sync_account(), exactly
# like "Sync now": same window, same dedup, same row lock (an account a user
# is syncing right now is skipped), and failures are recorded on the link so
# the Bank Feeds page shows them.
#
# Pacing: BankSync allows 10 requests a minute, so accounts are synced one
# at a time and the job turns on the provider's own request pacing
# (pace_requests), which spaces EVERY request, each page of a long account
# included. A 429 is retried once after the wait the provider asks for.
#
# Exit code: 0 if every account synced or was skipped for an expected reason
# (not linked, consent expired, already syncing); 1 if any failed, so the
# Railway run shows as failed.
#
# Logs counts and link ids only — never payees, amounts or provider messages.

import logging
import sys
import time
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401  (every model, so relationships resolve outside the web app)
from app.database import get_session_factory
from app.logging_config import configure_logging
from app.models.bank_connection import BankAccountLink, BankConnection
from app.models.user import User
from app.services.bank_feed_sync import SyncFailed, SyncSkipped, describe_error, sync_account
from app.services.bank_feeds import providers_for_user
from app.services.bank_feeds.provider import BankFeedProvider

# Named explicitly: run with `python -m`, __name__ is "__main__", which sits
# outside the `app` logger configure_logging() prints, so Railway saw nothing.
logger = logging.getLogger("app.jobs.sync_bank_feeds")

# Seconds between provider requests: 7s keeps a run under 10 requests a minute.
PACE_SECONDS = 7
# How long to wait after a 429 that doesn't say (seconds).
DEFAULT_RETRY_AFTER = 60

# Skips that mean the account is set up wrong rather than "nothing to do".
# provider_unavailable: e.g. BANKSYNC_API_KEY missing from the cron service.
_FAILING_SKIPS = {"provider_unavailable"}

_UNEXPECTED_ERROR = "Tidal hit an unexpected error while syncing. It will try again tomorrow."


def _links_to_sync(db: Session) -> list[tuple[uuid.UUID, User]]:
    """(link id, owner) for every linked bank account on an active connection."""
    rows = (
        db.query(BankAccountLink.id, User)
        .join(BankConnection, BankAccountLink.connection_id == BankConnection.id)
        .join(User, BankAccountLink.user_id == User.id)
        .filter(
            BankAccountLink.account_id.isnot(None),
            BankConnection.status == "active",
            User.deleted_at.is_(None),
        )
        .order_by(User.id, BankAccountLink.created_at)
        .all()
    )
    return [(link_id, user) for link_id, user in rows]


def _record_unexpected_error(db: Session, link_id: uuid.UUID) -> None:
    # Best effort, so the page shows something went wrong.
    try:
        link = db.get(BankAccountLink, link_id)
        if link is not None:
            link.last_sync_attempt_at = datetime.now(timezone.utc)
            link.last_sync_error = _UNEXPECTED_ERROR
            db.commit()
    except Exception:
        db.rollback()


def _with_pacing(providers: dict[str, BankFeedProvider]) -> dict[str, BankFeedProvider]:
    # Only providers with a rate limit offer pace_requests (BankSync).
    for provider in providers.values():
        pace = getattr(provider, "pace_requests", None)
        if pace is not None:
            pace(PACE_SECONDS)
    return providers


def _sync_one(db: Session, link_id: uuid.UUID, providers: dict[str, BankFeedProvider]) -> str:
    """Syncs one account, retrying once after a 429.

    Returns "synced", "skipped" or "failed".
    """
    for attempt in (1, 2):
        link = db.get(BankAccountLink, link_id)
        try:
            result = sync_account(db, link, providers)
        except SyncSkipped as exc:
            if exc.reason in _FAILING_SKIPS:
                logger.error("Link %s not synced: %s", link_id, exc.reason)
                return "failed"
            logger.info("Link %s skipped: %s", link_id, exc.reason)
            return "skipped"
        except SyncFailed as exc:
            if exc.error.status_code == 429 and attempt == 1:
                wait = exc.error.retry_after or DEFAULT_RETRY_AFTER
                logger.warning("Link %s rate limited; retrying in %ds", link_id, wait)
                time.sleep(wait)
                continue
            logger.error("Link %s failed: %s", link_id, describe_error(exc.error))
            return "failed"
        except Exception as exc:
            # The type only: database errors can quote the row being written.
            db.rollback()
            logger.error("Link %s failed unexpectedly (%s)", link_id, type(exc).__name__)
            _record_unexpected_error(db, link_id)
            return "failed"
        logger.info(
            "Link %s synced: %d created, %d duplicates",
            link_id, result["created"], result["skipped_duplicates"],
        )
        return "synced"
    raise AssertionError("unreachable")  # pragma: no cover


def main(session_factory: sessionmaker | None = None) -> int:
    """Syncs every linked account. Returns the process exit code (0 or 1)."""
    factory = session_factory or get_session_factory()
    counts = {"synced": 0, "skipped": 0, "failed": 0}
    providers_by_user: dict[uuid.UUID, dict[str, BankFeedProvider]] = {}

    with factory() as db:
        targets = _links_to_sync(db)
        logger.info("Bank feed sync starting: %d linked account(s)", len(targets))
        for link_id, user in targets:
            if user.id not in providers_by_user:
                # The same gate as the routes: BankSync only for its owner.
                providers_by_user[user.id] = _with_pacing(providers_for_user(user))
            counts[_sync_one(db, link_id, providers_by_user[user.id])] += 1

    logger.info(
        "Bank feed sync finished: %d synced, %d skipped, %d failed",
        counts["synced"], counts["skipped"], counts["failed"],
    )
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    configure_logging()
    sys.exit(main())
