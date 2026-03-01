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

from fastapi.testclient import TestClient

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
