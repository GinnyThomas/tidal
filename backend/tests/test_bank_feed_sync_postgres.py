# tests/test_bank_feed_sync_postgres.py
#
# Purpose: Prove the bank sync row lock really works on PostgreSQL.
#
# sync_account() locks the link with SELECT … FOR UPDATE NOWAIT so a manual
# "Sync now" and the daily job can't import the same account at once.
# SQLite ignores FOR UPDATE, so the SQLite tests only fake the error; this
# one holds a real lock in one session and syncs from another.
#
# Opt-in like test_migrations_rls.py: runs only when POSTGRES_TEST_URL points
# at a local database with "test" in its name (CI always sets it). The tables
# are created in their own schema, which is dropped afterwards, so the
# migration tests' public schema is never touched.

import os
import uuid
from collections.abc import Generator
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import Engine, create_engine, make_url, text
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401  (registers every table with Base.metadata)
from app.database import Base
from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection
from app.models.user import User
from app.services.bank_feed_sync import SyncSkipped, lock_link_query, sync_account
from tests.bank_feed_fakes import FakeProvider, _feed_tx

POSTGRES_TEST_URL = os.environ.get("POSTGRES_TEST_URL")
LOCAL_HOSTS = (None, "", "localhost", "127.0.0.1", "::1")
SCHEMA = "bank_sync_lock_test"

pytestmark = pytest.mark.skipif(
    not POSTGRES_TEST_URL, reason="set POSTGRES_TEST_URL to run PostgreSQL tests"
)


@pytest.fixture
def engine() -> Generator[Engine, None, None]:
    parsed = make_url(POSTGRES_TEST_URL or "")
    if parsed.host not in LOCAL_HOSTS or "test" not in (parsed.database or ""):
        pytest.fail("POSTGRES_TEST_URL must be a local database with 'test' in its name")
    admin = create_engine(POSTGRES_TEST_URL or "")
    with admin.begin() as conn:
        conn.execute(text(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE"))
        conn.execute(text(f"CREATE SCHEMA {SCHEMA}"))
    # Every connection of this engine resolves table names in the test schema.
    engine = create_engine(POSTGRES_TEST_URL or "", connect_args={"options": f"-csearch_path={SCHEMA}"})
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()
    with admin.begin() as conn:
        conn.execute(text(f"DROP SCHEMA {SCHEMA} CASCADE"))
    admin.dispose()


def _linked_account(db: Session) -> uuid.UUID:
    user = User(email="owner@example.com", password_hash="x")
    db.add(user)
    db.flush()
    account = Account(user_id=user.id, name="Monzo Current", account_type="checking", currency="GBP")
    connection = BankConnection(
        user_id=user.id, provider="fake", institution_name="Monzo", institution_country="GB",
        status="active", session_id="sess-1", valid_until=datetime.now(timezone.utc) + timedelta(days=90),
    )
    db.add_all([account, connection])
    db.flush()
    link = BankAccountLink(
        user_id=user.id, connection_id=connection.id, provider_account_uid="uid-1", account_id=account.id,
    )
    db.add(link)
    db.commit()
    return link.id


def test_second_sync_of_a_locked_account_is_skipped_not_doubled(engine) -> None:
    factory = sessionmaker(bind=engine, autoflush=False)
    with factory() as setup:
        link_id = _linked_account(setup)
    fake = FakeProvider()
    fake.transactions = [_feed_tx("e1")]

    with factory() as running, factory() as second:
        lock_link_query(running, link_id).one()  # a sync in progress holds the row

        with pytest.raises(SyncSkipped) as exc_info:
            sync_account(second, second.get(BankAccountLink, link_id), {"fake": fake})

        assert exc_info.value.reason == "locked"
        assert fake.fetch_calls == []
        running.rollback()  # the first sync finishes; the lock is released

        result = sync_account(second, second.get(BankAccountLink, link_id), {"fake": fake})

    assert result["created"] == 1
