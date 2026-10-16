# tests/test_health.py
#
# Purpose: Tests for the health check endpoint.
#
# TDD approach: these tests define what "correct" looks like.
# Run them before the implementation exists → they fail (Red).
# Write the implementation → they pass (Green).
# Tidy up the code → still pass (Refactor).
#
# We test behaviour, not implementation:
#   - Does the endpoint return the right status code?
#   - Does it return the right response body?
# We don't care HOW it does it internally.

from typing import Generator

from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.database import get_db
from app.main import app

# TestClient wraps our FastAPI app and lets us make HTTP requests in tests
# without starting a real server. Under the hood it uses httpx.
# This is a synchronous client — fine for our synchronous health endpoint.
client = TestClient(app)


def test_health_check_returns_200() -> None:
    """The health endpoint must return HTTP 200 OK."""
    response = client.get("/api/v1/health")

    assert response.status_code == 200


def test_health_check_returns_correct_body() -> None:
    """The health endpoint must return the expected JSON body."""
    response = client.get("/api/v1/health")

    # We assert on the full body, not just one field.
    # This catches regressions if either key is accidentally removed or renamed.
    assert response.json() == {"status": "ok", "app": "Tidal"}


def test_health_check_content_type_is_json() -> None:
    """The health endpoint must declare JSON as its content type."""
    response = client.get("/api/v1/health")

    # FastAPI sets this automatically, but it's worth asserting explicitly —
    # if someone accidentally changes the return type, this test will catch it.
    assert "application/json" in response.headers["content-type"]


# --- Database health check ---
# GET /api/v1/health/db proves the app can actually reach PostgreSQL.
# /api/v1/health only proves the process is up ("liveness"); this is the
# "readiness" check. It's also what the keep-alive workflow pings so that
# Supabase's free tier sees real query activity and doesn't pause the project.

def test_db_health_check_returns_200_when_database_reachable(test_client) -> None:
    """With a working database the endpoint runs a query and reports ok."""
    response = test_client.get("/api/v1/health/db")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


class _UnreachableSession:
    """Stand-in session whose queries fail the way a paused database would."""

    def execute(self, *args: object, **kwargs: object) -> None:
        raise OperationalError("SELECT 1", {}, Exception("connection refused to db.secret-host:5432"))


def test_db_health_check_returns_503_when_database_unreachable() -> None:
    """A failed query must surface as 503 so monitors (and the keep-alive job) fail loudly."""
    def override_get_db() -> Generator[_UnreachableSession, None, None]:
        yield _UnreachableSession()

    app.dependency_overrides[get_db] = override_get_db
    try:
        response = client.get("/api/v1/health/db")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    # Public endpoint: the body must not leak hostnames or driver errors.
    assert response.json() == {"status": "unavailable", "database": "unreachable"}
    assert "secret-host" not in response.text
