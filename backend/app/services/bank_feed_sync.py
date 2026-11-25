# app/services/bank_feed_sync.py
#
# Purpose: Sync one linked bank account — the logic shared by the manual
# "Sync now" route (POST /bank-feeds/links/{id}/sync) and the daily job
# (app/jobs/sync_bank_feeds.py). One code path, so both behave the same.
#
# It raises domain errors, not HTTP ones; each caller decides what they mean:
#   SyncSkipped — nothing was asked of the provider (not linked, consent
#                 expired, provider not available, Tidal account deleted, or
#                 another sync of this account is running). Route → 409/404/503;
#                 job → logs and moves on.
#   SyncFailed  — the provider call failed. The error is recorded on the link
#                 (last_sync_error) so the Bank Feeds page can show it.
#                 Route → 429/502; job → counts it as an error.
#
# Concurrency: the link row is locked with SELECT … FOR UPDATE NOWAIT until
# the sync commits. Dedup in importer.py works on a snapshot of existing ids,
# so two syncs of one account running together (a click during the daily
# run) could both insert the same transaction; the lock makes the second one
# give up straight away instead. SQLite (tests) ignores FOR UPDATE.

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Query, Session

from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection
from app.services.bank_feeds.provider import BankFeedError, BankFeedProvider
from app.services.importer import ImportRow, import_rows

logger = logging.getLogger(__name__)

# How far back the first sync of an account reaches.
FIRST_SYNC_DAYS = 90
# Later syncs re-read this much of the previous window: banks can book a
# transaction days after it happened. Dedup drops the ones we already have.
SYNC_OVERLAP_DAYS = 7

SkipReason = Literal["unlinked", "expired", "provider_unavailable", "account_missing", "locked"]


class SyncSkipped(Exception):
    """The account wasn't synced, for an expected reason. The provider wasn't called."""

    def __init__(self, reason: SkipReason, message: str) -> None:
        super().__init__(message)
        self.reason = reason


class SyncFailed(Exception):
    """The provider call failed. The error has been recorded on the link."""

    def __init__(self, error: BankFeedError) -> None:
        super().__init__(str(error))
        self.error = error


def as_utc(value: datetime) -> datetime:
    # SQLite (tests) returns naive datetimes; PostgreSQL returns aware ones.
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def is_expired(connection: BankConnection) -> bool:
    # None = the provider doesn't report an expiry (only pre-connected
    # providers; a completed consent-flow connection always has one).
    return connection.valid_until is not None and as_utc(connection.valid_until) <= datetime.now(timezone.utc)


def describe_error(exc: BankFeedError) -> str:
    """A short explanation of a provider error, safe to show on the page and log.

    Built from the status code only: provider messages can echo parts of a
    response (BankSync's "unexpected transaction: …" includes the transaction).
    """
    if exc.status_code == 429:
        return "The bank feed provider was busy (rate limited). The next sync will try again."
    if exc.status_code in (401, 403):
        return "The bank feed provider rejected Tidal's API key. It may have expired: create a new one."
    if exc.status_code is None:
        return "Tidal couldn't reach the bank feed provider."
    return f"The bank feed provider returned an error (HTTP {exc.status_code})."


def lock_link_query(db: Session, link_id) -> Query:
    """The link row, locked until commit; fails at once if another sync holds it."""
    return (
        db.query(BankAccountLink)
        .filter(BankAccountLink.id == link_id)
        .with_for_update(nowait=True)
        .populate_existing()  # re-read: a sync that just finished moved last_synced_at
    )


def _lock_link(db: Session, link: BankAccountLink) -> BankAccountLink:
    return lock_link_query(db, link.id).one()


# PostgreSQL's SQLSTATE for "could not obtain lock on row" (what NOWAIT raises).
_LOCK_NOT_AVAILABLE = "55P03"


def _is_lock_contention(exc: OperationalError) -> bool:
    # psycopg2 exposes the SQLSTATE as pgcode. Anything else (a dropped
    # connection, say) is a real failure, not "another sync is running".
    return getattr(exc.orig, "pgcode", None) == _LOCK_NOT_AVAILABLE


def sync_account(db: Session, link: BankAccountLink, providers: dict[str, BankFeedProvider]) -> dict:
    """
    Imports the bank account's booked transactions into its linked Tidal account.

    providers: what the link's owner may use (providers_for_user), so the
    BANKSYNC_OWNER_EMAIL gate applies here too.

    Returns import_rows()'s result. Raises SyncSkipped or SyncFailed.
    Commits on success and on provider failure.
    """
    try:
        link = _lock_link(db, link)
    except OperationalError as exc:
        db.rollback()
        if not _is_lock_contention(exc):
            raise
        raise SyncSkipped("locked", "A sync is already running for this account. Try again in a minute.")

    if link.account_id is None:
        db.rollback()
        raise SyncSkipped("unlinked", "Link this bank account to a Tidal account first.")
    if is_expired(link.connection):
        db.rollback()
        raise SyncSkipped("expired", "Bank consent has expired. Reconnect the bank.")
    account = db.query(Account).filter(
        Account.id == link.account_id,
        Account.user_id == link.user_id,
        Account.deleted_at.is_(None),
    ).first()
    if account is None:
        db.rollback()
        raise SyncSkipped("account_missing", "The linked Tidal account no longer exists.")
    # The provider that created the connection is the only one that knows its ids.
    provider = providers.get(link.connection.provider)
    if provider is None:
        db.rollback()
        raise SyncSkipped("provider_unavailable", "This bank feed provider is not available on this server.")

    if link.last_synced_at is None:
        date_from = date.today() - timedelta(days=FIRST_SYNC_DAYS)
    else:
        date_from = as_utc(link.last_synced_at).date() - timedelta(days=SYNC_OVERLAP_DAYS)

    now = datetime.now(timezone.utc)
    try:
        feed = provider.fetch_transactions(link.provider_account_uid, date_from)
    except BankFeedError as exc:
        link.last_sync_attempt_at = now
        link.last_sync_error = describe_error(exc)
        db.commit()
        raise SyncFailed(exc) from exc

    rows = [
        ImportRow(date=tx.date, amount=tx.amount, payee=tx.payee, notes=tx.notes, external_id=tx.external_id)
        for tx in feed
    ]
    # Set before import_rows(), which commits: the new transactions and the
    # moved window then land in ONE commit, which also releases the lock. If
    # the import fails it rolls back both.
    link.last_synced_at = now
    link.last_sync_attempt_at = now
    link.last_sync_error = None
    result = import_rows(db, link.user_id, account, rows)
    db.commit()  # import_rows only commits when it created something
    logger.info(
        "Bank sync for link %s: %d fetched, %d created, %d duplicates",
        link.id, len(feed), result["created"], result["skipped_duplicates"],
    )
    return result
