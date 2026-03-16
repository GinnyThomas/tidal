# tests/conftest.py
#
# Purpose: pytest configuration and shared fixtures for all tests.
#
# conftest.py is special — pytest loads it automatically before collecting
# or running any tests. Fixtures defined here are available to every test
# in this directory and its subdirectories without needing to import them.
#
# IMPORTANT: Environment variables must be set at the very top of this file,
# before any `from app import ...` statements. Why? Because importing
# app.config triggers Settings(), which reads env vars immediately.
# If the vars aren't set yet, pydantic-settings raises a validation error.

import os
from typing import Generator

# Set required environment variables before any app imports.
# os.environ.setdefault only sets the variable if it isn't already set,
# so a real .env file takes precedence if present.
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://test_user:test_password@127.0.0.1:5432/tidal_test",
)
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production")

# --- App imports (after env vars are set) ---
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app.database import Base, get_db
from app.main import app  # Importing app triggers all router and model imports,
                           # which registers all table definitions with Base.metadata.


# --- Test database strategy ---
#
# We use SQLite in-memory for all tests. Reasons:
#
#   1. No PostgreSQL server required — tests run anywhere without setup
#   2. In-memory = destroyed at end of each test — perfect isolation
#   3. Entirely in RAM — very fast
#
# SQLite quirk: normally each new connection to ":memory:" gets a FRESH,
# empty database. Our test setup and the app's request handlers use
# different connections, so they'd see different databases — tests would
# fail immediately because no tables exist from the app's perspective.
#
# Fix: StaticPool makes ALL requests reuse a SINGLE underlying connection.
# Now our CREATE TABLE calls and the app's INSERT/SELECT calls all see
# the same in-memory database.
SQLITE_TEST_URL = "sqlite:///:memory:"


@pytest.fixture(scope="function")
def test_client() -> Generator[TestClient, None, None]:
    """
    Provides a TestClient backed by a fresh SQLite in-memory database.

    Scope is "function" — each test function gets its own completely clean
    database. This means tests cannot interfere with each other, no matter
    what order they run in.

    Usage in tests:
        def test_something(test_client) -> None:
            response = test_client.post("/api/v1/auth/register", json={...})
    """
    # Create a fresh SQLite engine for this test function.
    # check_same_thread=False: SQLite's default safety check assumes only one
    # thread uses a connection. We disable it because pytest may use threads.
    engine = create_engine(
        SQLITE_TEST_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    # Create all tables. Because we imported app.main above (which imports
    # all routers, which import all models), every table definition is now
    # registered with Base.metadata — including the users table.
    Base.metadata.create_all(bind=engine)

    # Session factory for this test's database.
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db() -> Generator[Session, None, None]:
        """
        Replaces the real get_db dependency with one that uses our test database.
        FastAPI's dependency_overrides mechanism swaps this in for the duration
        of the test, then we clear it afterwards.
        """
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    # Inject the test database session into all routes that use get_db.
    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as client:
        yield client

    # Cleanup: restore the real dependency and tear down the test database.
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()
