# tests/test_bank_feed_sync.py
#
# Tests for services/bank_feed_sync.py — the sync logic shared by the
# "Sync now" route and the daily job — and for providers_for_user(), the
# plain-function provider lookup the job uses (no request, no logged-in user).
#
# The route-level behaviour (status codes) is tested in test_bank_feeds.py.

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_session_factory
from app.main import app
from app.models.account import Account
from app.models.bank_connection import BankAccountLink
from app.models.user import User
from app.services import bank_feed_sync
from app.services.bank_feed_sync import SyncFailed, SyncSkipped, lock_link_query, sync_account
from app.services.bank_feeds import providers_for_user
from app.services.bank_feeds.provider import BankFeedError
from tests.bank_feed_fakes import FakeProvider, _feed_tx, seed_link, seed_user


# =============================================================================
# Helpers
# =============================================================================


@pytest.fixture
def db(test_client) -> Session:
    """A session on the test database (the one test_client's routes use)."""
    session = app.dependency_overrides[get_session_factory]()()
    yield session
    session.close()


def _user(test_client, db: Session, email: str = "user@example.com") -> User:
    return seed_user(test_client, db, email)


def _link(db: Session, user: User, **kwargs) -> BankAccountLink:
    return seed_link(db, user, **kwargs)


# =============================================================================
# providers_for_user
# =============================================================================


def _configure_banksync(monkeypatch, owner: str = "owner@example.com") -> None:
    monkeypatch.setattr(settings, "ENABLE_BANKING_APPLICATION_ID", "")
    monkeypatch.setattr(settings, "ENABLE_BANKING_PRIVATE_KEY", "")
    monkeypatch.setattr(settings, "BANKSYNC_API_KEY", "bsk_test")
    monkeypatch.setattr(settings, "BANKSYNC_OWNER_EMAIL", owner)


def test_providers_for_user_offers_banksync_to_its_owner(monkeypatch) -> None:
    _configure_banksync(monkeypatch, owner="Owner@Example.com")

    assert list(providers_for_user(User(email="owner@example.com"))) == ["banksync"]


def test_providers_for_user_hides_banksync_from_everyone_else(monkeypatch) -> None:
    _configure_banksync(monkeypatch)

    assert providers_for_user(User(email="demo@example.com")) == {}


# =============================================================================
# sync_account — success
# =============================================================================


def test_sync_account_imports_and_records_success(test_client, db) -> None:
    user = _user(test_client, db)
    link = _link(db, user)
    fake = FakeProvider()
    fake.transactions = [_feed_tx("e1"), _feed_tx("e2", "-3.00", "Co-op")]

    result = sync_account(db, link, {"fake": fake})

    assert result["created"] == 2
    db.refresh(link)
    assert link.last_synced_at is not None
    assert link.last_sync_attempt_at is not None
    assert link.last_sync_error is None


def test_sync_account_first_sync_reads_90_days_then_overlaps_a_week(test_client, db) -> None:
    user = _user(test_client, db)
    link = _link(db, user)
    fake = FakeProvider()

    sync_account(db, link, {"fake": fake})
    sync_account(db, link, {"fake": fake})

    assert [d for _, d in fake.fetch_calls] == [
        date.today() - timedelta(days=90),
        date.today() - timedelta(days=7),
    ]


def test_sync_account_success_clears_previous_error(test_client, db) -> None:
    user = _user(test_client, db)
    link = _link(db, user)
    fake = FakeProvider()
    fake.error = BankFeedError("down", status_code=500)
    with pytest.raises(SyncFailed):
        sync_account(db, link, {"fake": fake})

    fake.error = None
    sync_account(db, link, {"fake": fake})

    db.refresh(link)
    assert link.last_sync_error is None


# =============================================================================
# sync_account — skipped (nothing asked of the provider)
# =============================================================================


def test_sync_account_skips_unlinked_account(test_client, db) -> None:
    user = _user(test_client, db)
    link = _link(db, user, linked=False)
    fake = FakeProvider()

    with pytest.raises(SyncSkipped) as exc_info:
        sync_account(db, link, {"fake": fake})

    assert exc_info.value.reason == "unlinked"
    assert fake.fetch_calls == []


def test_sync_account_skips_expired_consent(test_client, db) -> None:
    user = _user(test_client, db)
    link = _link(db, user, valid_until=datetime.now(timezone.utc) - timedelta(days=1))
    fake = FakeProvider()

    with pytest.raises(SyncSkipped) as exc_info:
        sync_account(db, link, {"fake": fake})

    assert exc_info.value.reason == "expired"
    assert fake.fetch_calls == []


def test_sync_account_skips_when_provider_unavailable(test_client, db) -> None:
    user = _user(test_client, db)
    link = _link(db, user, provider="banksync")

    with pytest.raises(SyncSkipped) as exc_info:
        sync_account(db, link, {"fake": FakeProvider()})

    assert exc_info.value.reason == "provider_unavailable"


def test_sync_account_skips_deleted_tidal_account(test_client, db) -> None:
    user = _user(test_client, db)
    link = _link(db, user)
    db.get(Account, link.account_id).deleted_at = datetime.now(timezone.utc)
    db.commit()

    with pytest.raises(SyncSkipped) as exc_info:
        sync_account(db, link, {"fake": FakeProvider()})

    assert exc_info.value.reason == "account_missing"


class _DriverError(Exception):
    """Stands in for a psycopg2 error, which carries the SQLSTATE as pgcode."""

    def __init__(self, pgcode: str) -> None:
        super().__init__("driver error")
        self.pgcode = pgcode


def _raise_operational_error(pgcode: str):
    def lock(*_args, **_kwargs):
        raise OperationalError("SELECT … FOR UPDATE NOWAIT", {}, _DriverError(pgcode))
    return lock


def test_sync_account_skips_when_another_sync_holds_the_lock(test_client, db, monkeypatch) -> None:
    # SQLite can't block on a row lock, so stand in for PostgreSQL's
    # "could not obtain lock" (55P03, raised by NOWAIT).
    user = _user(test_client, db)
    link = _link(db, user)
    fake = FakeProvider()
    monkeypatch.setattr(bank_feed_sync, "_lock_link", _raise_operational_error("55P03"))

    with pytest.raises(SyncSkipped) as exc_info:
        sync_account(db, link, {"fake": fake})

    assert exc_info.value.reason == "locked"
    assert fake.fetch_calls == []


def test_sync_account_other_database_errors_are_not_reported_as_locked(test_client, db, monkeypatch) -> None:
    # e.g. the connection dropped (08006): a real failure, not "already running".
    user = _user(test_client, db)
    link = _link(db, user)
    monkeypatch.setattr(bank_feed_sync, "_lock_link", _raise_operational_error("08006"))

    with pytest.raises(OperationalError):
        sync_account(db, link, {"fake": FakeProvider()})


def test_lock_query_asks_postgres_for_row_lock_without_waiting(test_client, db) -> None:
    sql = str(lock_link_query(db, uuid.uuid4()).statement.compile(dialect=postgresql.dialect()))

    assert "FOR UPDATE NOWAIT" in sql


# =============================================================================
# sync_account — provider errors are recorded on the link
# =============================================================================


def test_sync_account_provider_error_records_it_and_keeps_last_synced(test_client, db) -> None:
    user = _user(test_client, db)
    link = _link(db, user)
    fake = FakeProvider()
    # Provider messages can echo response bodies; they must not reach the page.
    fake.error = BankFeedError("unexpected transaction: payee='Tesco'", status_code=500)

    with pytest.raises(SyncFailed) as exc_info:
        sync_account(db, link, {"fake": fake})

    assert exc_info.value.error is fake.error
    db.refresh(link)
    assert link.last_synced_at is None
    assert link.last_sync_attempt_at is not None
    assert link.last_sync_error
    assert "Tesco" not in link.last_sync_error


def test_sync_account_rejected_key_error_says_so(test_client, db) -> None:
    user = _user(test_client, db)
    link = _link(db, user)
    fake = FakeProvider()
    fake.error = BankFeedError("Invalid or expired API key", status_code=401)

    with pytest.raises(SyncFailed):
        sync_account(db, link, {"fake": fake})

    db.refresh(link)
    assert "API key" in link.last_sync_error


def test_sync_account_rate_limit_error_says_so(test_client, db) -> None:
    user = _user(test_client, db)
    link = _link(db, user)
    fake = FakeProvider()
    fake.error = BankFeedError("slow down", status_code=429, retry_after=30)

    with pytest.raises(SyncFailed):
        sync_account(db, link, {"fake": fake})

    db.refresh(link)
    assert "busy" in link.last_sync_error
