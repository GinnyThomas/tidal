# tests/test_reallocations.py
#
# Purpose: Tests for the Reallocations endpoints.
#
# Test coverage:
#   - Create: valid reallocation returns 201 with correct fields
#   - Validation: missing/empty reason returns 422
#   - Auth: missing JWT returns 401
#   - Data scoping: users only see their own reallocations
#   - Immutability: no DELETE endpoint exists (405 or 404)
#   - Plan integration: reallocation adjusts planned amounts in plan view
#
# Pattern: same helpers as other test files.
# Each test gets a fresh SQLite database from conftest.py's test_client fixture.


# =============================================================================
# Helpers
# =============================================================================


def _register_and_login(
    test_client,
    email: str = "user@example.com",
    password: str = "securepassword",
) -> str:
    """Register a user and return a valid JWT access token."""
    test_client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password},
    )
    response = test_client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    return response.json()["access_token"]


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _get_two_category_ids(test_client, token: str) -> tuple[str, str]:
    """Return the first two seeded system category ids."""
    categories = test_client.get(
        "/api/v1/categories",
        headers=_auth_headers(token),
    ).json()
    return categories[0]["id"], categories[1]["id"]


def _setup(test_client, email: str = "user@example.com"):
    """Register a user, return (token, from_category_id, to_category_id)."""
    token = _register_and_login(test_client, email)
    cat_a, cat_b = _get_two_category_ids(test_client, token)
    return token, cat_a, cat_b


# A minimal valid reallocation payload (category IDs added per-test).
_REALLOC = {
    "amount": "100.00",
    "reason": "Birthday dinner — moving budget from groceries",
    "month": 1,
    "year": 2026,
}


# =============================================================================
# Create reallocation
# =============================================================================


def test_create_reallocation_returns_201(test_client) -> None:
    """
    Creating a valid reallocation should return 201 with the expected fields.
    Defaults: currency=GBP.
    """
    token, cat_a, cat_b = _setup(test_client)

    response = test_client.post(
        "/api/v1/reallocations",
        json={**_REALLOC, "from_category_id": cat_a, "to_category_id": cat_b},
        headers=_auth_headers(token),
    )

    assert response.status_code == 201

    body = response.json()
    assert body["amount"] == "100.00"
    assert body["currency"] == "GBP"
    assert body["reason"] == "Birthday dinner — moving budget from groceries"
    assert body["month"] == 1
    assert body["year"] == 2026
    assert body["from_category_id"] == cat_a
    assert body["to_category_id"] == cat_b
    assert "id" in body
    assert "user_id" in body
    assert "created_at" in body


def test_create_reallocation_without_reason_returns_422(test_client) -> None:
    """Omitting the reason field entirely should return 422."""
    token, cat_a, cat_b = _setup(test_client)

    payload = {
        "from_category_id": cat_a,
        "to_category_id": cat_b,
        "amount": "50.00",
        "month": 1,
        "year": 2026,
        # reason intentionally omitted
    }
    response = test_client.post(
        "/api/v1/reallocations",
        json=payload,
        headers=_auth_headers(token),
    )
    assert response.status_code == 422


def test_create_reallocation_with_empty_reason_returns_422(test_client) -> None:
    """
    A reason that is empty or whitespace-only must be rejected with 422.
    Whitespace-only reasons defeat the purpose of the audit trail.
    """
    token, cat_a, cat_b = _setup(test_client)

    for bad_reason in ("", "   ", "\t\n"):
        response = test_client.post(
            "/api/v1/reallocations",
            json={**_REALLOC, "from_category_id": cat_a, "to_category_id": cat_b,
                  "reason": bad_reason},
            headers=_auth_headers(token),
        )
        assert response.status_code == 422, f"Expected 422 for reason={bad_reason!r}"


def test_create_reallocation_without_auth_returns_401(test_client) -> None:
    """Posting without an Authorization header should return 401."""
    response = test_client.post(
        "/api/v1/reallocations",
        json={
            **_REALLOC,
            "from_category_id": "00000000-0000-0000-0000-000000000001",
            "to_category_id": "00000000-0000-0000-0000-000000000002",
        },
    )
    assert response.status_code == 401


# =============================================================================
# List reallocations
# =============================================================================


def test_list_reallocations_returns_only_current_users(test_client) -> None:
    """
    Each user must only see their own reallocations.
    User A's reallocation must not appear in User B's list.
    """
    token_a, cat_a1, cat_a2 = _setup(test_client, "user_a@example.com")
    token_b, cat_b1, cat_b2 = _setup(test_client, "user_b@example.com")

    test_client.post(
        "/api/v1/reallocations",
        json={**_REALLOC, "from_category_id": cat_a1, "to_category_id": cat_a2,
              "reason": "User A reason"},
        headers=_auth_headers(token_a),
    )
    test_client.post(
        "/api/v1/reallocations",
        json={**_REALLOC, "from_category_id": cat_b1, "to_category_id": cat_b2,
              "reason": "User B reason"},
        headers=_auth_headers(token_b),
    )

    response = test_client.get("/api/v1/reallocations", headers=_auth_headers(token_a))

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["reason"] == "User A reason"


# =============================================================================
# Immutability
# =============================================================================


def test_reallocation_cannot_be_deleted(test_client) -> None:
    """
    There is no DELETE endpoint for reallocations — they are a permanent
    audit trail. A DELETE request should return 404 or 405.

    Why not 403 Forbidden?
      A 403 would imply the resource exists but access is denied. We want
      to communicate that the operation simply does not exist on this resource.
      404 (no route) or 405 (method not allowed) are both correct; we accept
      either here since it depends on FastAPI's routing behaviour.
    """
    token, cat_a, cat_b = _setup(test_client)

    create_response = test_client.post(
        "/api/v1/reallocations",
        json={**_REALLOC, "from_category_id": cat_a, "to_category_id": cat_b},
        headers=_auth_headers(token),
    )
    assert create_response.status_code == 201
    reallocation_id = create_response.json()["id"]

    delete_response = test_client.delete(
        f"/api/v1/reallocations/{reallocation_id}",
        headers=_auth_headers(token),
    )
    # 404 (no route registered) or 405 (method not allowed) — both mean "no DELETE"
    assert delete_response.status_code in (404, 405)


# =============================================================================
# Plan integration
# =============================================================================


def test_reallocation_adjusts_plan_view(test_client) -> None:
    """
    A reallocation for a given month should adjust the planned amounts shown
    in the plan view for that month.

    Setup:
      - Schedule A: £300 planned for category A in January 2026
      - Schedule B: £100 planned for category B in January 2026
      - Reallocation: move £50 FROM category A TO category B

    Expected plan after reallocation:
      - Category A planned: 300 - 50 = £250
      - Category B planned: 100 + 50 = £150
    """
    token, cat_a, cat_b = _setup(test_client)

    # Create an account (needed for schedules)
    account_response = test_client.post(
        "/api/v1/accounts",
        json={"name": "Test Account", "account_type": "checking"},
        headers=_auth_headers(token),
    )
    account_id = account_response.json()["id"]

    # Schedule A: £300 planned for cat_a
    test_client.post(
        "/api/v1/schedules",
        json={
            "name": "Schedule A", "amount": "300.00", "frequency": "monthly",
            "start_date": "2026-01-01", "account_id": account_id, "category_id": cat_a,
        },
        headers=_auth_headers(token),
    )

    # Schedule B: £100 planned for cat_b
    test_client.post(
        "/api/v1/schedules",
        json={
            "name": "Schedule B", "amount": "100.00", "frequency": "monthly",
            "start_date": "2026-01-01", "account_id": account_id, "category_id": cat_b,
        },
        headers=_auth_headers(token),
    )

    # Baseline: verify plan before reallocation
    plan_before = test_client.get("/api/v1/plan/2026/1", headers=_auth_headers(token)).json()
    row_a_before = next(r for r in plan_before["rows"] if r["category_id"] == cat_a)
    row_b_before = next(r for r in plan_before["rows"] if r["category_id"] == cat_b)
    assert row_a_before["planned"] == "300.00"
    assert row_b_before["planned"] == "100.00"

    # Create reallocation: move £50 from A to B
    test_client.post(
        "/api/v1/reallocations",
        json={
            "from_category_id": cat_a,
            "to_category_id": cat_b,
            "amount": "50.00",
            "reason": "Reallocating for birthday",
            "month": 1,
            "year": 2026,
        },
        headers=_auth_headers(token),
    )

    # Plan after: A loses 50, B gains 50
    plan_after = test_client.get("/api/v1/plan/2026/1", headers=_auth_headers(token)).json()
    row_a_after = next(r for r in plan_after["rows"] if r["category_id"] == cat_a)
    row_b_after = next(r for r in plan_after["rows"] if r["category_id"] == cat_b)
    assert row_a_after["planned"] == "250.00"
    assert row_b_after["planned"] == "150.00"
