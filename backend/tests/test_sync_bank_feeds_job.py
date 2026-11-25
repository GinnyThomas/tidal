# tests/test_sync_bank_feeds_job.py
#
# Tests for app/jobs/sync_bank_feeds.py — the daily Railway cron job that
# syncs every linked bank account, with no HTTP request and no logged-in user.
#
# The job runs against the SQLite test database through the session factory
# test_client sets up. time.sleep is replaced so pacing and 429 retries are
# recorded instead of waited for.

import logging
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.database import Base, get_session_factory
from app.jobs import sync_bank_feeds as job
from app.main import app
from app.models.bank_connection import BankAccountLink
from app.services import bank_feeds
from app.services.bank_feeds.provider import BankFeedError
from tests.bank_feed_fakes import FakeProvider, FakePreConnectedProvider, _feed_tx, seed_link, seed_user

BACKEND_DIR = Path(__file__).resolve().parent.parent


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def factory(test_client) -> sessionmaker:
    return app.dependency_overrides[get_session_factory]()


@pytest.fixture
def db(factory) -> Session:
    session = factory()
    yield session
    session.close()


@pytest.fixture
def sleeps(monkeypatch) -> list[float]:
    calls: list[float] = []
    monkeypatch.setattr(job.time, "sleep", calls.append)
    return calls


@pytest.fixture
def fake(monkeypatch) -> FakeProvider:
    """Every user may use the "fake" provider."""
    provider = FakeProvider()
    monkeypatch.setattr(job, "providers_for_user", lambda user: {provider.name: provider})
    return provider


class PerAccountProvider(FakeProvider):
    """Fails (or rate-limits) chosen accounts; the rest succeed."""

    def __init__(self) -> None:
        super().__init__()
        # uid → errors to raise on successive calls, then succeed.
        self.errors_by_uid: dict[str, list[BankFeedError]] = {}

    def fetch_transactions(self, account_uid, date_from):
        self.fetch_calls.append((account_uid, date_from))
        pending = self.errors_by_uid.get(account_uid)
        if pending:
            raise pending.pop(0)
        return self.transactions


@pytest.fixture
def per_account(monkeypatch) -> PerAccountProvider:
    provider = PerAccountProvider()
    monkeypatch.setattr(job, "providers_for_user", lambda user: {provider.name: provider})
    return provider


# =============================================================================
# Which accounts are synced
# =============================================================================


def test_syncs_linked_accounts_and_returns_0(test_client, db, factory, fake, sleeps) -> None:
    user = seed_user(test_client, db)
    link = seed_link(db, user)
    fake.transactions = [_feed_tx("e1")]

    assert job.main(factory) == 0

    assert [uid for uid, _ in fake.fetch_calls] == ["uid-1"]
    db.refresh(link)
    assert link.last_synced_at is not None


def test_skips_unlinked_and_expired_accounts(test_client, db, factory, fake, sleeps) -> None:
    user = seed_user(test_client, db)
    seed_link(db, user, uid="linked")
    seed_link(db, user, uid="unlinked", linked=False)
    seed_link(db, user, uid="expired", valid_until=datetime.now(timezone.utc) - timedelta(days=1))

    assert job.main(factory) == 0  # skipping for an expected reason isn't a failure

    assert [uid for uid, _ in fake.fetch_calls] == ["linked"]


def test_syncs_every_users_accounts(test_client, db, factory, fake, sleeps) -> None:
    seed_link(db, seed_user(test_client, db, "a@example.com"), uid="a")
    seed_link(db, seed_user(test_client, db, "b@example.com"), uid="b")

    assert job.main(factory) == 0

    assert sorted(uid for uid, _ in fake.fetch_calls) == ["a", "b"]


def test_skips_deleted_users(test_client, db, factory, fake, sleeps) -> None:
    user = seed_user(test_client, db)
    seed_link(db, user)
    user.deleted_at = datetime.now(timezone.utc)
    db.commit()

    assert job.main(factory) == 0

    assert fake.fetch_calls == []


def test_only_syncs_banksync_for_its_owner(test_client, db, factory, sleeps, monkeypatch) -> None:
    # The real providers_for_user, so the BANKSYNC_OWNER_EMAIL gate is the
    # one the routes use; only the BankSync client itself is faked.
    banksync = FakePreConnectedProvider()
    banksync.name = "banksync"
    monkeypatch.setattr(settings, "ENABLE_BANKING_APPLICATION_ID", "")
    monkeypatch.setattr(settings, "ENABLE_BANKING_PRIVATE_KEY", "")
    monkeypatch.setattr(settings, "BANKSYNC_API_KEY", "bsk_test")
    monkeypatch.setattr(settings, "BANKSYNC_OWNER_EMAIL", "owner@example.com")
    monkeypatch.setattr(bank_feeds, "_banksync", None)
    monkeypatch.setattr(bank_feeds, "BankSyncProvider", lambda api_key: banksync)
    seed_link(db, seed_user(test_client, db, "owner@example.com"), provider="banksync", uid="owner-acc")
    seed_link(db, seed_user(test_client, db, "demo@example.com"), provider="banksync", uid="demo-acc")

    job.main(factory)

    assert [uid for uid, _ in banksync.fetch_calls] == ["owner-acc"]


# =============================================================================
# Failures, pacing and retries
# =============================================================================


def test_continues_after_a_failure_and_returns_1(test_client, db, factory, per_account, sleeps) -> None:
    user = seed_user(test_client, db)
    failing = seed_link(db, user, uid="failing")
    healthy = seed_link(db, user, uid="healthy")
    per_account.errors_by_uid["failing"] = [BankFeedError("down", status_code=500)]

    assert job.main(factory) == 1

    assert sorted(uid for uid, _ in per_account.fetch_calls) == ["failing", "healthy"]
    db.refresh(failing)
    db.refresh(healthy)
    assert failing.last_sync_error is not None
    assert healthy.last_synced_at is not None


def test_provider_not_available_counts_as_a_failure(test_client, db, factory, sleeps, monkeypatch) -> None:
    # e.g. BANKSYNC_API_KEY removed from the cron service's variables: the
    # run should go red in Railway, not quietly sync nothing.
    monkeypatch.setattr(job, "providers_for_user", lambda user: {})
    seed_link(db, seed_user(test_client, db))

    assert job.main(factory) == 1


class PacedProvider(FakeProvider):
    """Records pace_requests() like BankSyncProvider, which paces every request."""

    def __init__(self) -> None:
        super().__init__()
        self.paced_at: list[float] = []

    def pace_requests(self, seconds: float) -> None:
        self.paced_at.append(seconds)


def test_turns_on_request_pacing_for_providers_that_offer_it(
    test_client, db, factory, sleeps, monkeypatch,
) -> None:
    # Pacing lives in the provider, per request, so a multi-page account
    # can't burst past BankSync's 10 requests a minute.
    paced = PacedProvider()
    monkeypatch.setattr(job, "providers_for_user", lambda user: {paced.name: paced})
    seed_link(db, seed_user(test_client, db))

    job.main(factory)

    assert paced.paced_at and set(paced.paced_at) == {job.PACE_SECONDS}
    assert job.PACE_SECONDS * 10 >= 60


def test_does_not_sleep_between_accounts_itself(test_client, db, factory, fake, sleeps) -> None:
    # Skipped accounts make no request, so nothing to wait for; the
    # provider spaces the requests that are made.
    user = seed_user(test_client, db)
    seed_link(db, user, uid="a")
    seed_link(db, user, uid="expired", valid_until=datetime.now(timezone.utc) - timedelta(days=1))
    seed_link(db, user, uid="c")

    job.main(factory)

    assert sleeps == []


def test_retries_once_after_rate_limit(test_client, db, factory, per_account, sleeps) -> None:
    user = seed_user(test_client, db)
    link = seed_link(db, user, uid="acc")
    per_account.errors_by_uid["acc"] = [BankFeedError("slow down", status_code=429, retry_after=30)]

    assert job.main(factory) == 0

    assert len(per_account.fetch_calls) == 2
    assert 30 in sleeps
    db.refresh(link)
    assert link.last_sync_error is None


def test_rate_limit_without_retry_after_waits_a_minute(test_client, db, factory, per_account, sleeps) -> None:
    seed_link(db, seed_user(test_client, db), uid="acc")
    per_account.errors_by_uid["acc"] = [BankFeedError("slow down", status_code=429)]

    job.main(factory)

    assert 60 in sleeps


def test_gives_up_after_a_second_rate_limit(test_client, db, factory, per_account, sleeps) -> None:
    seed_link(db, seed_user(test_client, db), uid="acc")
    per_account.errors_by_uid["acc"] = [
        BankFeedError("slow down", status_code=429, retry_after=30),
        BankFeedError("slow down", status_code=429, retry_after=30),
    ]

    assert job.main(factory) == 1

    assert len(per_account.fetch_calls) == 2


def test_unexpected_error_is_recorded_and_the_run_continues(
    test_client, db, factory, per_account, sleeps, monkeypatch,
) -> None:
    user = seed_user(test_client, db)
    broken = seed_link(db, user, uid="broken")
    seed_link(db, user, uid="fine")
    real_sync = job.sync_account

    def sync(session, link, providers):
        if link.provider_account_uid == "broken":
            raise RuntimeError("payee='Secret Shop' amount=12.34")
        return real_sync(session, link, providers)

    monkeypatch.setattr(job, "sync_account", sync)

    assert job.main(factory) == 1

    assert [uid for uid, _ in per_account.fetch_calls] == ["fine"]
    db.refresh(broken)
    assert broken.last_sync_error is not None
    assert broken.last_sync_attempt_at is not None


# =============================================================================
# Logging
# =============================================================================


def test_logs_one_line_per_account_and_no_transaction_details(
    test_client, db, factory, per_account, sleeps, caplog, monkeypatch,
) -> None:
    caplog.set_level(logging.INFO, logger="app")
    user = seed_user(test_client, db)
    ok = seed_link(db, user, uid="ok")
    bad = seed_link(db, user, uid="bad")
    per_account.transactions = [_feed_tx("e1", "-99.99", "Secret Shop")]
    per_account.errors_by_uid["bad"] = [BankFeedError("unexpected transaction: payee='Secret Shop'", status_code=500)]

    job.main(factory)

    assert str(ok.id) in caplog.text
    assert str(bad.id) in caplog.text
    assert "Secret Shop" not in caplog.text
    assert "99.99" not in caplog.text


# =============================================================================
# Entry point
# =============================================================================


def test_runs_as_a_module_and_logs_to_stderr(tmp_path) -> None:
    # Exactly what the Railway cron service runs. Run as `python -m`, the
    # module's __name__ is "__main__", so this also catches a logger that sits
    # outside configure_logging()'s `app` logger (Railway would see nothing).
    db_url = f"sqlite:///{tmp_path / 'job.db'}"
    engine = create_engine(db_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    completed = subprocess.run(
        [sys.executable, "-m", "app.jobs.sync_bank_feeds"],
        cwd=BACKEND_DIR,
        env={**os.environ, "DATABASE_URL": db_url, "SECRET_KEY": "test"},
        capture_output=True, text=True, timeout=60,
    )

    assert completed.returncode == 0, completed.stderr
    assert "Bank feed sync finished: 0 synced, 0 skipped, 0 failed" in completed.stderr
