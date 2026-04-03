# tests/test_plan.py
#
# Purpose: Tests for the Monthly Plan View endpoint.
#
# Test coverage:
#   - Scheduled amounts appear as "planned" in the plan view
#   - Actual only includes cleared and reconciled transactions (not pending)
#   - Pending transactions shown separately — not counted in actual
#   - Schedules that start after the target month are excluded
#   - Remaining = 0.00 when actual equals planned
#   - Categories with transactions but no schedules still appear in plan rows
#
# All tests target January 2026 (GET /api/v1/plan/2026/1). This month is
# unambiguous and avoids any "is the schedule in the future?" edge cases
# related to test execution time.
#
# Pattern: same helpers as other test files. Fresh SQLite per test.


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


def _create_account(test_client, token: str) -> str:
    """Create a checking account and return its id."""
    response = test_client.post(
        "/api/v1/accounts",
        json={"name": "Test Account", "account_type": "checking"},
        headers=_auth_headers(token),
    )
    return response.json()["id"]


def _get_category_id(test_client, token: str) -> str:
    """Return the first seeded system category id."""
    categories = test_client.get(
        "/api/v1/categories",
        headers=_auth_headers(token),
    ).json()
    return categories[0]["id"]


def _setup(test_client, email: str = "user@example.com"):
    """Register, create account, return (token, account_id, category_id)."""
    token = _register_and_login(test_client, email)
    account_id = _create_account(test_client, token)
    category_id = _get_category_id(test_client, token)
    return token, account_id, category_id


def _create_schedule(test_client, token: str, account_id: str, category_id: str, **kwargs) -> dict:
    """Create a schedule and return the response body."""
    defaults = {
        "name": "Test Schedule",
        "amount": "100.00",
        "frequency": "monthly",
        "start_date": "2026-01-01",
        "account_id": account_id,
        "category_id": category_id,
    }
    response = test_client.post(
        "/api/v1/schedules",
        json={**defaults, **kwargs},
        headers=_auth_headers(token),
    )
    assert response.status_code == 201, f"Schedule create failed: {response.json()}"
    return response.json()


def _create_transaction(test_client, token: str, account_id: str, category_id: str, **kwargs) -> dict:
    """Create a transaction and return the response body."""
    defaults = {
        "date": "2026-01-15",
        "amount": "100.00",
        "transaction_type": "expense",
        "status": "cleared",
        "account_id": account_id,
        "category_id": category_id,
    }
    response = test_client.post(
        "/api/v1/transactions",
        json={**defaults, **kwargs},
        headers=_auth_headers(token),
    )
    assert response.status_code == 201, f"Transaction create failed: {response.json()}"
    return response.json()


# =============================================================================
# Plan tests
# =============================================================================


def test_plan_includes_scheduled_amount_as_planned(test_client) -> None:
    """
    A monthly schedule that falls within the target month should appear as
    the 'planned' amount in the corresponding category row.
    """
    token, account_id, category_id = _setup(test_client)

    _create_schedule(
        test_client, token, account_id, category_id,
        amount="500.00",
        frequency="monthly",
        start_date="2026-01-01",
    )

    response = test_client.get("/api/v1/plan/2026/1", headers=_auth_headers(token))

    assert response.status_code == 200
    body = response.json()
    assert len(body["rows"]) >= 1

    row = next(r for r in body["rows"] if r["category_id"] == category_id)
    assert row["planned"] == "500.00"


def test_plan_actual_includes_only_cleared_and_reconciled(test_client) -> None:
    """
    The 'actual' amount should sum only cleared and reconciled transactions.
    A pending transaction in the same month must NOT be counted in actual.
    """
    token, account_id, category_id = _setup(test_client)

    # Cleared: counts
    _create_transaction(test_client, token, account_id, category_id, amount="100.00", status="cleared")
    # Reconciled: also counts
    _create_transaction(test_client, token, account_id, category_id, amount="50.00", status="reconciled")
    # Pending: must NOT count toward actual
    _create_transaction(test_client, token, account_id, category_id, amount="200.00", status="pending")

    response = test_client.get("/api/v1/plan/2026/1", headers=_auth_headers(token))

    assert response.status_code == 200
    row = next(r for r in response.json()["rows"] if r["category_id"] == category_id)
    assert row["actual"] == "150.00"   # 100 + 50, not 350


def test_plan_pending_shown_separately(test_client) -> None:
    """
    Pending transactions must appear in the 'pending' field of the plan row —
    not in 'actual'. This is the core invariant: pending transactions
    must never corrupt the view of what has actually been spent.
    """
    token, account_id, category_id = _setup(test_client)

    _create_transaction(
        test_client, token, account_id, category_id,
        amount="75.00",
        status="pending",
    )

    response = test_client.get("/api/v1/plan/2026/1", headers=_auth_headers(token))

    assert response.status_code == 200
    row = next(r for r in response.json()["rows"] if r["category_id"] == category_id)
    assert row["pending"] == "75.00"
    assert row["actual"] == "0.00"


def test_plan_excludes_schedules_starting_after_month_end(test_client) -> None:
    """
    A schedule whose start_date is after the last day of the target month
    should not contribute any planned amount to that month's plan.

    In this test the schedule starts in March 2026 and we query January 2026.
    With no transactions either, the category should not appear in the rows.
    """
    token, account_id, category_id = _setup(test_client)

    _create_schedule(
        test_client, token, account_id, category_id,
        amount="999.00",
        frequency="monthly",
        start_date="2026-03-01",  # Starts in March — must not fire in January
    )

    response = test_client.get("/api/v1/plan/2026/1", headers=_auth_headers(token))

    assert response.status_code == 200
    # No row should exist for this category — no planned, no actual, no pending
    category_row = next(
        (r for r in response.json()["rows"] if r["category_id"] == category_id),
        None,
    )
    assert category_row is None


def test_plan_returns_zero_remaining_when_actual_equals_planned(test_client) -> None:
    """
    When the actual spend exactly equals the planned amount, remaining should
    be 0.00. This confirms the remaining = planned - actual calculation.
    """
    token, account_id, category_id = _setup(test_client)

    _create_schedule(
        test_client, token, account_id, category_id,
        amount="200.00",
        frequency="monthly",
        start_date="2026-01-01",
    )
    _create_transaction(
        test_client, token, account_id, category_id,
        amount="200.00",
        status="cleared",
    )

    response = test_client.get("/api/v1/plan/2026/1", headers=_auth_headers(token))

    assert response.status_code == 200
    row = next(r for r in response.json()["rows"] if r["category_id"] == category_id)
    assert row["planned"] == "200.00"
    assert row["actual"] == "200.00"
    assert row["remaining"] == "0.00"


def test_plan_shows_categories_with_transactions_even_without_schedules(test_client) -> None:
    """
    A category that has transactions but no schedule should still appear in
    the plan rows. Actual spend exists even if nothing was planned for it.

    This covers unplanned expenses — the plan view must surface them so the
    user can see where unbudgeted money went.
    """
    token, account_id, category_id = _setup(test_client)

    # No schedule — just a transaction
    _create_transaction(
        test_client, token, account_id, category_id,
        amount="42.00",
        status="cleared",
    )

    response = test_client.get("/api/v1/plan/2026/1", headers=_auth_headers(token))

    assert response.status_code == 200
    row = next(
        (r for r in response.json()["rows"] if r["category_id"] == category_id),
        None,
    )
    assert row is not None
    assert row["actual"] == "42.00"
    assert row["planned"] == "0.00"
