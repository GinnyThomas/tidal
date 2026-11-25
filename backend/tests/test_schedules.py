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
#   - Deactivation: records deactivated_on, never touches end_date
#
# Pattern: same helpers as test_transactions.py.
# Each test gets a fresh SQLite database from conftest.py's test_client fixture.

from datetime import date, timedelta

from app.models.schedule import Schedule
from app.services.plan import effective_end_date


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


def test_schedule_next_date_old_start_date(test_client) -> None:
    """
    A monthly schedule with a start_date 3 years in the past should still
    compute a future next_occurrence on the correct day_of_month.
    """
    from datetime import date

    token = _register_and_login(test_client)
    account_id = _create_account(test_client, token)
    category_id = _get_category_id(test_client, token)

    response = test_client.post(
        "/api/v1/schedules",
        json={
            "name": "Old Schedule",
            "amount": "50.00",
            "frequency": "monthly",
            "start_date": "2023-03-01",
            "day_of_month": 20,
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
    assert next_date.day == 20


def test_schedule_next_date_respects_end_date(test_client) -> None:
    """
    A schedule whose end_date is in the past should have next_occurrence = null.
    """
    token = _register_and_login(test_client)
    account_id = _create_account(test_client, token)
    category_id = _get_category_id(test_client, token)

    response = test_client.post(
        "/api/v1/schedules",
        json={
            "name": "Ended Schedule",
            "amount": "100.00",
            "frequency": "monthly",
            "start_date": "2024-01-01",
            "end_date": "2025-06-30",
            "account_id": account_id,
            "category_id": category_id,
        },
        headers=_auth_headers(token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["next_occurrence"] is None


def test_create_transfer_schedule(test_client) -> None:
    """
    A transfer schedule should have schedule_type='transfer' with
    from_account_id and to_account_id set, and no category required.
    """
    token = _register_and_login(test_client)
    from_id = _create_account(test_client, token, name="From Acct")
    to_id = _create_account(test_client, token, name="To Acct")

    response = test_client.post(
        "/api/v1/schedules",
        json={
            "name": "Monthly Savings Transfer",
            "amount": "500.00",
            "frequency": "monthly",
            "start_date": "2026-01-01",
            "account_id": from_id,
            "schedule_type": "transfer",
            "from_account_id": from_id,
            "to_account_id": to_id,
        },
        headers=_auth_headers(token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["schedule_type"] == "transfer"
    assert body["from_account_id"] == from_id
    assert body["to_account_id"] == to_id
    assert body["category_id"] is None


# =============================================================================
# Catch-up
# =============================================================================


def test_catchup_single_overdue_occurrence(test_client) -> None:
    """Single schedule, one overdue occurrence: creates one transaction."""
    token, account_id, category_id = _setup(test_client)

    test_client.post(
        "/api/v1/schedules",
        json={**_SCHEDULE, "account_id": account_id, "category_id": category_id,
              "start_date": "2026-01-01", "frequency": "monthly"},
        headers=_auth_headers(token),
    )

    # Catch up to Jan 15 — one occurrence on Jan 1
    resp = test_client.post(
        "/api/v1/schedules/catch-up",
        json={"today": "2026-01-15"},
        headers=_auth_headers(token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 1


def test_catchup_three_overdue_periods(test_client) -> None:
    """Single schedule, three overdue periods: creates three transactions."""
    token, account_id, category_id = _setup(test_client)

    test_client.post(
        "/api/v1/schedules",
        json={**_SCHEDULE, "account_id": account_id, "category_id": category_id,
              "start_date": "2026-01-01", "frequency": "monthly"},
        headers=_auth_headers(token),
    )

    # Catch up to March 15 — Jan 1, Feb 1, Mar 1 are all overdue
    resp = test_client.post(
        "/api/v1/schedules/catch-up",
        json={"today": "2026-03-15"},
        headers=_auth_headers(token),
    )
    assert resp.status_code == 200
    assert resp.json()["count"] == 3


def test_catchup_skips_inactive_schedules(test_client) -> None:
    """Only active=true schedules process; inactive are skipped."""
    token, account_id, category_id = _setup(test_client)

    # Create and immediately deactivate
    sched_resp = test_client.post(
        "/api/v1/schedules",
        json={**_SCHEDULE, "account_id": account_id, "category_id": category_id,
              "start_date": "2026-01-01", "frequency": "monthly"},
        headers=_auth_headers(token),
    )
    sched_id = sched_resp.json()["id"]
    test_client.patch(
        f"/api/v1/schedules/{sched_id}/toggle-active",
        headers=_auth_headers(token),
    )

    resp = test_client.post(
        "/api/v1/schedules/catch-up",
        json={"today": "2026-03-15"},
        headers=_auth_headers(token),
    )
    assert resp.json()["count"] == 0


def test_catchup_no_due_occurrences(test_client) -> None:
    """Schedule whose next occurrence is in the future: no transactions created."""
    token, account_id, category_id = _setup(test_client)

    test_client.post(
        "/api/v1/schedules",
        json={**_SCHEDULE, "account_id": account_id, "category_id": category_id,
              "start_date": "2026-06-01", "frequency": "monthly"},
        headers=_auth_headers(token),
    )

    # Catch up to May 15 — schedule starts June, nothing due
    resp = test_client.post(
        "/api/v1/schedules/catch-up",
        json={"today": "2026-05-15"},
        headers=_auth_headers(token),
    )
    assert resp.json()["count"] == 0


def test_catchup_creates_pending_transactions_with_schedule_id(test_client) -> None:
    """Auto-created transactions have status=pending and schedule_id set."""
    token, account_id, category_id = _setup(test_client)

    sched_resp = test_client.post(
        "/api/v1/schedules",
        json={**_SCHEDULE, "account_id": account_id, "category_id": category_id,
              "start_date": "2026-01-01", "frequency": "monthly"},
        headers=_auth_headers(token),
    )
    sched_id = sched_resp.json()["id"]

    test_client.post(
        "/api/v1/schedules/catch-up",
        json={"today": "2026-01-15"},
        headers=_auth_headers(token),
    )

    # Check the created transaction
    txs = test_client.get(
        "/api/v1/transactions",
        headers=_auth_headers(token),
    ).json()["items"]
    assert len(txs) == 1
    assert txs[0]["status"] == "pending"
    assert txs[0]["schedule_id"] == sched_id


def test_catchup_idempotent_second_call(test_client) -> None:
    """Second catch-up call on same day creates no duplicates."""
    token, account_id, category_id = _setup(test_client)

    test_client.post(
        "/api/v1/schedules",
        json={**_SCHEDULE, "account_id": account_id, "category_id": category_id,
              "start_date": "2026-01-01", "frequency": "monthly"},
        headers=_auth_headers(token),
    )

    # First call
    resp1 = test_client.post(
        "/api/v1/schedules/catch-up",
        json={"today": "2026-01-15"},
        headers=_auth_headers(token),
    )
    assert resp1.json()["count"] == 1

    # Second call — same date, should find nothing new
    resp2 = test_client.post(
        "/api/v1/schedules/catch-up",
        json={"today": "2026-01-15"},
        headers=_auth_headers(token),
    )
    assert resp2.json()["count"] == 0



# =============================================================================
# Deactivation records deactivated_on and never touches end_date
#
# The annual plan includes inactive schedules on purpose (their past months
# are real history), so it needs to know when a schedule stopped. That goes
# in deactivated_on, set on active → inactive and cleared on reactivation.
# end_date is the user's own data (when the standing order or contract ends)
# and is left alone, so pausing then resuming loses nothing.
# =============================================================================


def _create_schedule(test_client, token, account_id, category_id, **overrides) -> dict:
    response = test_client.post(
        "/api/v1/schedules",
        json={**_SCHEDULE, "account_id": account_id, "category_id": category_id,
              "start_date": "2026-01-01", "frequency": "monthly", **overrides},
        headers=_auth_headers(token),
    )
    assert response.status_code == 201
    return response.json()


def _toggle(test_client, token, sched_id: str) -> dict:
    response = test_client.patch(
        f"/api/v1/schedules/{sched_id}/toggle-active",
        headers=_auth_headers(token),
    )
    assert response.status_code == 200
    return response.json()


def _put(test_client, token, sched_id: str, body: dict) -> dict:
    response = test_client.put(
        f"/api/v1/schedules/{sched_id}", json=body, headers=_auth_headers(token),
    )
    assert response.status_code == 200
    return response.json()


def _planned_for(test_client, token, category_id: str, month: date) -> str | None:
    """The category's planned amount in that month's plan, or None if it has no row."""
    plan = test_client.get(
        f"/api/v1/plan/{month.year}/{month.month}", headers=_auth_headers(token),
    ).json()
    rows = [r for r in plan["rows"] if r["category_id"] == category_id]
    return rows[0]["planned"] if rows else None


def _next_month(d: date) -> date:
    return date(d.year + (d.month == 12), d.month % 12 + 1, 1)


def _previous_month(d: date) -> date:
    return date(d.year - (d.month == 1), (d.month - 2) % 12 + 1, 1)


def _monthly_since_last_year(test_client, token, account_id, category_id, **overrides) -> dict:
    """A monthly schedule on the 1st that has been running since January last year."""
    start = date(date.today().year - 1, 1, 1).isoformat()
    return _create_schedule(
        test_client, token, account_id, category_id,
        start_date=start, day_of_month=1, **overrides,
    )


def test_new_schedule_has_no_deactivated_on(test_client) -> None:
    token, account_id, category_id = _setup(test_client)

    sched = _create_schedule(test_client, token, account_id, category_id)

    assert sched["deactivated_on"] is None


def test_toggle_inactive_records_today_and_leaves_empty_end_date(test_client) -> None:
    token, account_id, category_id = _setup(test_client)
    sched = _create_schedule(test_client, token, account_id, category_id)

    body = _toggle(test_client, token, sched["id"])

    assert body["active"] is False
    assert body["deactivated_on"] == date.today().isoformat()
    assert body["end_date"] is None
    # Persisted, not just in the response
    fetched = test_client.get(f"/api/v1/schedules/{sched['id']}", headers=_auth_headers(token)).json()
    assert fetched["deactivated_on"] == date.today().isoformat()


def test_toggle_inactive_keeps_users_future_end_date(test_client) -> None:
    """A loan or contract end date is the user's data: pausing must not rewrite it."""
    token, account_id, category_id = _setup(test_client)
    future = (date.today() + timedelta(days=700)).isoformat()
    sched = _create_schedule(test_client, token, account_id, category_id, end_date=future)

    body = _toggle(test_client, token, sched["id"])

    assert body["end_date"] == future


def test_pause_then_resume_restores_the_schedule(test_client) -> None:
    """The reported problem with the first version: resume left a dead schedule."""
    token, account_id, category_id = _setup(test_client)
    future = (date.today() + timedelta(days=700)).isoformat()
    sched = _monthly_since_last_year(test_client, token, account_id, category_id, end_date=future)
    next_occurrence = sched["next_occurrence"]

    _toggle(test_client, token, sched["id"])
    body = _toggle(test_client, token, sched["id"])

    assert body["active"] is True
    assert body["deactivated_on"] is None
    assert body["end_date"] == future
    assert body["next_occurrence"] == next_occurrence
    assert _planned_for(test_client, token, category_id, _next_month(date.today())) == "1200.00"


def test_inactive_schedule_has_no_next_occurrence(test_client) -> None:
    token, account_id, category_id = _setup(test_client)
    sched = _monthly_since_last_year(test_client, token, account_id, category_id)

    body = _toggle(test_client, token, sched["id"])

    assert body["next_occurrence"] is None


def test_update_to_inactive_records_deactivated_on(test_client) -> None:
    token, account_id, category_id = _setup(test_client)
    sched = _create_schedule(test_client, token, account_id, category_id)

    body = _put(test_client, token, sched["id"], {"active": False})

    assert body["deactivated_on"] == date.today().isoformat()
    assert body["end_date"] is None


def test_update_to_inactive_keeps_end_date_sent_in_same_request(test_client) -> None:
    token, account_id, category_id = _setup(test_client)
    sched = _create_schedule(test_client, token, account_id, category_id)
    future = (date.today() + timedelta(days=60)).isoformat()

    body = _put(test_client, token, sched["id"], {"active": False, "end_date": future})

    assert body["end_date"] == future
    assert body["deactivated_on"] == date.today().isoformat()


def test_update_to_active_clears_deactivated_on(test_client) -> None:
    token, account_id, category_id = _setup(test_client)
    sched = _create_schedule(test_client, token, account_id, category_id)
    _toggle(test_client, token, sched["id"])

    body = _put(test_client, token, sched["id"], {"active": True})

    assert body["deactivated_on"] is None


def test_editing_an_inactive_schedule_keeps_deactivated_on(test_client) -> None:
    """Only the active → inactive change records the date. Clearing end_date in
    the edit form (it always sends end_date) can't bring the schedule back."""
    token, account_id, category_id = _setup(test_client)
    sched = _create_schedule(test_client, token, account_id, category_id)
    _toggle(test_client, token, sched["id"])

    body = _put(test_client, token, sched["id"], {"name": "Old rent", "end_date": None})

    assert body["deactivated_on"] == date.today().isoformat()


def test_deactivated_on_is_not_client_settable(test_client) -> None:
    token, account_id, category_id = _setup(test_client)
    sched = _create_schedule(test_client, token, account_id, category_id)

    body = _put(test_client, token, sched["id"], {"deactivated_on": "2020-01-01"})

    assert body["deactivated_on"] is None


def test_create_inactive_schedule_records_today(test_client) -> None:
    token, account_id, category_id = _setup(test_client)

    sched = _create_schedule(test_client, token, account_id, category_id, active=False)

    assert sched["deactivated_on"] == date.today().isoformat()
    assert sched["end_date"] is None


def test_deactivated_schedule_stops_appearing_in_later_plan_months(test_client) -> None:
    """The original bug: an inactive schedule kept filling the annual plan."""
    token, account_id, category_id = _setup(test_client)
    sched = _monthly_since_last_year(test_client, token, account_id, category_id)
    assert _planned_for(test_client, token, category_id, _next_month(date.today())) == "1200.00"

    _toggle(test_client, token, sched["id"])

    assert _planned_for(test_client, token, category_id, _next_month(date.today())) is None


def test_deactivated_schedule_still_counts_in_past_months(test_client) -> None:
    """Past months are history: deactivating today doesn't rewrite them."""
    token, account_id, category_id = _setup(test_client)
    sched = _monthly_since_last_year(test_client, token, account_id, category_id)

    _toggle(test_client, token, sched["id"])

    assert _planned_for(test_client, token, category_id, _previous_month(date.today())) == "1200.00"


# effective_end_date(): the plan's bound for a schedule, tested directly


def _sched(active: bool, end_date: date | None, deactivated_on: date | None) -> Schedule:
    return Schedule(active=active, end_date=end_date, deactivated_on=deactivated_on)


def test_effective_end_active_schedule_uses_end_date_only() -> None:
    # A stale deactivated_on on an active schedule is ignored
    assert effective_end_date(_sched(True, date(2027, 6, 30), date(2026, 1, 1))) == date(2027, 6, 30)
    assert effective_end_date(_sched(True, None, None)) is None


def test_effective_end_inactive_without_end_date_is_deactivated_on() -> None:
    assert effective_end_date(_sched(False, None, date(2026, 11, 25))) == date(2026, 11, 25)


def test_effective_end_inactive_is_the_earlier_of_the_two() -> None:
    assert effective_end_date(_sched(False, date(2027, 6, 30), date(2026, 11, 25))) == date(2026, 11, 25)
    assert effective_end_date(_sched(False, date(2026, 3, 31), date(2026, 11, 25))) == date(2026, 3, 31)


def test_effective_end_inactive_without_deactivated_on_falls_back_to_end_date() -> None:
    assert effective_end_date(_sched(False, None, None)) is None
