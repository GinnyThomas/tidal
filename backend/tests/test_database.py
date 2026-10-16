# tests/test_database.py
#
# Purpose: Tests for engine configuration in app/database.py.

from app.database import connect_args_for


def test_postgres_connections_get_a_connect_timeout() -> None:
    """A paused or unreachable Supabase must fail fast, not hang a worker thread."""
    url = "postgresql://user:pw@db.example.supabase.co:6543/postgres"

    assert connect_args_for(url) == {"connect_timeout": 5}


def test_sqlite_connections_get_no_connect_args() -> None:
    """sqlite3.connect() rejects connect_timeout, so tests must not receive it."""
    assert connect_args_for("sqlite:///:memory:") == {}
