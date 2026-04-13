# tests/test_schedules.py
#
# Purpose: Tests for the Schedules endpoints.
#
# Test coverage:
#   - Create: returns 201 with correct fields
#   - Auth: missing JWT returns 401
#   - Data scoping: users only see their own schedules
#   - Get by ID: returns 200 with correct data
#   - Get other user's schedule: returns 404 (not 403 — we don't confirm existence)
#   - Update: changes are reflected in subsequent GET
#   - Soft delete: DELETE returns 204, subsequent GET returns 404
#   - Active filter: inactive schedules excluded from default list
#
# Pattern: same helpers as test_transactions.py.
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


def _create_account(
    test_client,
    token: str,
    name: str = "Test Account",
    account_type: str = "checking",
) -> str:
    """Create an account and return its id."""
    response = test_client.post(
        "/api/v1/accounts",
        json={"name": name, "account_type": account_type},
        headers=_auth_headers(token),
    )
    return response.json()["id"]


def _get_category_id(test_client, token: str) -> str:
    """Return the id of the first seeded system category."""
    categories = test_client.get(
        "/api/v1/categories",
        headers=_auth_headers(token),
    ).json()
    return categories[0]["id"]


def _setup(test_client, email: str = "user@example.com"):
    """Register a user, create one account, return (token, account_id, category_id)."""
    token = _register_and_login(test_client, email)
    account_id = _create_account(test_client, token)
    category_id = _get_category_id(test_client, token)
    return token, account_id, category_id


# A minimal valid schedule payload — missing account_id and category_id,
# which must be added per-test since they are created dynamically.
_SCHEDULE = {
    "name": "Monthly Rent",
    "amount": "1200.00",
    "frequency": "monthly",
    "start_date": "2026-02-01",
}


# =============================================================================
# Create schedule
# =============================================================================


def test_create_schedule_returns_201(test_client) -> None:
    """
    Creating a valid schedule should return 201 with the expected fields.
    Defaults: currency=GBP, interval=1, active=True, auto_generate=True.
    """
    token, account_id, category_id = _setup(test_client)

    response = test_client.post(
        "/api/v1/schedules",
        json={**_SCHEDULE, "account_id": account_id, "category_id": category_id},
        headers=_auth_headers(token),
    )

    assert response.status_code == 201

    body = response.json()
    assert body["name"] == "Monthly Rent"
    assert body["amount"] == "1200.00"
    assert body["frequency"] == "monthly"
    assert body["currency"] == "GBP"         # server default
    assert body["interval"] == 1              # server default
    assert body["active"] is True             # server default
    assert body["auto_generate"] is True      # server default
    assert body["account_id"] == account_id
    assert body["category_id"] == category_id
    assert "id" in body
    assert "user_id" in body
    assert "created_at" in body
    # category_name is denormalised from the Category row
    assert "category_name" in body
    assert isinstance(body["category_name"], str)


def test_create_schedule_without_auth_returns_401(test_client) -> None:
    """Posting without an Authorization header should return 401."""
    response = test_client.post(
        "/api/v1/schedules",
        json={
            **_SCHEDULE,
            "account_id": "00000000-0000-0000-0000-000000000001",
            "category_id": "00000000-0000-0000-0000-000000000002",
        },
    )
    assert response.status_code == 401


# =============================================================================
# List schedules
# =============================================================================


def test_list_schedules_returns_only_current_users_schedules(test_client) -> None:
    """
    Each user must only see their own schedules.

    We create one schedule per user and assert each user's list contains
    exactly one schedule — their own.
    """
    token_a, account_a, cat_a = _setup(test_client, "user_a@example.com")
    token_b, account_b, cat_b = _setup(test_client, "user_b@example.com")

    test_client.post(
        "/api/v1/schedules",
        json={**_SCHEDULE, "account_id": account_a, "category_id": cat_a, "name": "Rent A"},
        headers=_auth_headers(token_a),
    )
    test_client.post(
        "/api/v1/schedules",
        json={**_SCHEDULE, "account_id": account_b, "category_id": cat_b, "name": "Rent B"},
        headers=_auth_headers(token_b),
    )

    response = test_client.get("/api/v1/schedules", headers=_auth_headers(token_a))

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["name"] == "Rent A"


# =============================================================================
# Get single schedule
# =============================================================================


def test_get_schedule_by_id_returns_200(test_client) -> None:
    """GET /api/v1/schedules/{id} should return the schedule for the current user."""
    token, account_id, category_id = _setup(test_client)

    create_response = test_client.post(
        "/api/v1/schedules",
        json={**_SCHEDULE, "account_id": account_id, "category_id": category_id},
        headers=_auth_headers(token),
    )
    schedule_id = create_response.json()["id"]

    response = test_client.get(
        f"/api/v1/schedules/{schedule_id}",
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    assert response.json()["id"] == schedule_id


def test_get_other_users_schedule_returns_404(test_client) -> None:
    """
    A user should not be able to see another user's schedule.
    Returns 404 — we do not reveal whether the resource exists for another user.
    """
    token_a, account_a, cat_a = _setup(test_client, "user_a@example.com")
    token_b, _, _ = _setup(test_client, "user_b@example.com")

    create_response = test_client.post(
        "/api/v1/schedules",
        json={**_SCHEDULE, "account_id": account_a, "category_id": cat_a},
        headers=_auth_headers(token_a),
    )
    schedule_id = create_response.json()["id"]

    # User B tries to access User A's schedule
    response = test_client.get(
        f"/api/v1/schedules/{schedule_id}",
        headers=_auth_headers(token_b),
    )

    assert response.status_code == 404


# =============================================================================
# Update schedule
# =============================================================================


def test_update_schedule_reflects_changes(test_client) -> None:
    """
    PUT /api/v1/schedules/{id} should update only the provided fields.
    A subsequent GET should return the updated values.
    """
    token, account_id, category_id = _setup(test_client)

    create_response = test_client.post(
        "/api/v1/schedules",
        json={**_SCHEDULE, "account_id": account_id, "category_id": category_id},
        headers=_auth_headers(token),
    )
    schedule_id = create_response.json()["id"]

    update_response = test_client.put(
        f"/api/v1/schedules/{schedule_id}",
        json={"amount": "1350.00", "name": "New Rent"},
        headers=_auth_headers(token),
    )

    assert update_response.status_code == 200
    body = update_response.json()
    assert body["amount"] == "1350.00"
    assert body["name"] == "New Rent"
    # Unchanged field should still be present
    assert body["frequency"] == "monthly"


# =============================================================================
# Soft delete
# =============================================================================


def test_delete_schedule_is_soft_delete(test_client) -> None:
    """
    DELETE /api/v1/schedules/{id} should return 204 and make the schedule
    invisible through the API (GET returns 404). The row is NOT physically
    deleted — deleted_at is set instead.
    """
    token, account_id, category_id = _setup(test_client)

    create_response = test_client.post(
        "/api/v1/schedules",
        json={**_SCHEDULE, "account_id": account_id, "category_id": category_id},
        headers=_auth_headers(token),
    )
    schedule_id = create_response.json()["id"]

    delete_response = test_client.delete(
        f"/api/v1/schedules/{schedule_id}",
        headers=_auth_headers(token),
    )
    assert delete_response.status_code == 204

    # The schedule should now be invisible through the API
    get_response = test_client.get(
        f"/api/v1/schedules/{schedule_id}",
        headers=_auth_headers(token),
    )
    assert get_response.status_code == 404


# =============================================================================
# Active filter
# =============================================================================


def test_inactive_schedules_excluded_from_default_list(test_client) -> None:
    """
    Inactive schedules (active=False) should not appear in the default list.
    The user must explicitly pass ?include_inactive=true to see them.

    Why: the default list is used to show "what is currently scheduled to
    happen". A paused schedule should not clutter that view.
    """
    token, account_id, category_id = _setup(test_client)

    base = {"account_id": account_id, "category_id": category_id}

    # Create one active and one inactive schedule
    test_client.post(
        "/api/v1/schedules",
        json={**_SCHEDULE, **base, "name": "Active Schedule", "active": True},
        headers=_auth_headers(token),
    )
    test_client.post(
        "/api/v1/schedules",
        json={**_SCHEDULE, **base, "name": "Inactive Schedule", "active": False},
        headers=_auth_headers(token),
    )

    # Default list: only active
    default_response = test_client.get("/api/v1/schedules", headers=_auth_headers(token))
    assert default_response.status_code == 200
    default_body = default_response.json()
    assert len(default_body) == 1
    assert default_body[0]["name"] == "Active Schedule"

    # include_inactive=true: both are returned
    all_response = test_client.get(
        "/api/v1/schedules?include_inactive=true",
        headers=_auth_headers(token),
    )
    assert all_response.status_code == 200
    all_body = all_response.json()
    assert len(all_body) == 2


# =============================================================================
# Next occurrence
# =============================================================================


def test_schedule_next_date_is_future(test_client) -> None:
    """
    A monthly schedule starting in the past should have next_occurrence
    set to a future date (>= today).
    """
    from datetime import date

    token = _register_and_login(test_client)
    account_id = _create_account(test_client, token)
    category_id = _get_category_id(test_client, token)

    response = test_client.post(
        "/api/v1/schedules",
        json={
            "name": "Monthly Test",
            "amount": "100.00",
            "frequency": "monthly",
            "start_date": "2026-01-01",
            "day_of_month": 15,
            "account_id": account_id,
            "category_id": category_id,
        },
        headers=_auth_headers(token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["next_occurrence"] is not None

    next_date = date.fromisoformat(body["next_occurrence"])
    assert next_date >= date.today()
