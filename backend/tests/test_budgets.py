# tests/test_budgets.py
#
# Purpose: Tests for the Budgets endpoints and plan integration.
#
# Test coverage:
#   - Create: budget returns 201 with correct fields
#   - Duplicate: same category + year returns 409
#   - List: filtered by year query param
#   - Get: single budget includes overrides
#   - Update: default_amount changes
#   - Delete: hard delete (budget gone, not soft-deleted)
#   - Override: upsert a month override
#   - Plan integration: budget amounts appear in planned totals
#   - Plan integration: override amount used instead of default when set
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


def _create_budget(test_client, token: str, category_id: str, **kwargs) -> dict:
    """Create a budget and return the response body."""
    defaults = {
        "category_id": category_id,
        "year": 2026,
        "default_amount": "150.00",
    }
    response = test_client.post(
        "/api/v1/budgets",
        json={**defaults, **kwargs},
        headers=_auth_headers(token),
    )
    assert response.status_code == 201, f"Budget create failed: {response.json()}"
    return response.json()


# =============================================================================
# CRUD tests
# =============================================================================


def test_create_budget_returns_201(test_client) -> None:
    """
    Creating a valid budget should return 201 with the expected fields.
    Default currency is GBP.
    """
    token, _, category_id = _setup(test_client)

    budget = _create_budget(test_client, token, category_id)

    assert budget["default_amount"] == "150.00"
    assert budget["currency"] == "GBP"
    assert budget["year"] == 2026
    assert budget["category_id"] == category_id
    assert "id" in budget
    assert "user_id" in budget
    assert "created_at" in budget
    assert budget["overrides"] == []


def test_create_duplicate_budget_returns_409(test_client) -> None:
    """
    Attempting to create a second budget for the same category and year
    should return 409 Conflict — enforced by the unique constraint.
    """
    token, _, category_id = _setup(test_client)

    _create_budget(test_client, token, category_id)

    # Second create for the same category + year → 409
    response = test_client.post(
        "/api/v1/budgets",
        json={"category_id": category_id, "year": 2026, "default_amount": "200.00"},
        headers=_auth_headers(token),
    )
    assert response.status_code == 409


def test_list_budgets_filtered_by_year(test_client) -> None:
    """
    GET /api/v1/budgets?year=2026 should return only budgets for that year.
    Budgets for other years should be excluded.
    """
    token, _, category_id = _setup(test_client)

    # Get a second category for the second budget (unique constraint: user+category+year)
    categories = test_client.get(
        "/api/v1/categories",
        headers=_auth_headers(token),
    ).json()
    category_id_2 = categories[1]["id"]

    _create_budget(test_client, token, category_id, year=2026)
    _create_budget(test_client, token, category_id_2, year=2027)

    response = test_client.get(
        "/api/v1/budgets?year=2026",
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["year"] == 2026


def test_get_budget_includes_overrides(test_client) -> None:
    """
    GET /api/v1/budgets/{id} should include the budget's monthly overrides.
    """
    token, _, category_id = _setup(test_client)
    budget = _create_budget(test_client, token, category_id)

    # Add an override for March
    test_client.post(
        f"/api/v1/budgets/{budget['id']}/overrides",
        json={"month": 3, "amount": "250.00"},
        headers=_auth_headers(token),
    )

    response = test_client.get(
        f"/api/v1/budgets/{budget['id']}",
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body["overrides"]) == 1
    assert body["overrides"][0]["month"] == 3
    assert body["overrides"][0]["amount"] == "250.00"


def test_update_budget_default_amount(test_client) -> None:
    """
    PUT /api/v1/budgets/{id} should update the default_amount.
    """
    token, _, category_id = _setup(test_client)
    budget = _create_budget(test_client, token, category_id, default_amount="100.00")

    response = test_client.put(
        f"/api/v1/budgets/{budget['id']}",
        json={"default_amount": "200.00"},
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    assert response.json()["default_amount"] == "200.00"


def test_delete_budget(test_client) -> None:
    """
    DELETE /api/v1/budgets/{id} should hard-delete the budget.
    A subsequent GET should return 404.
    """
    token, _, category_id = _setup(test_client)
    budget = _create_budget(test_client, token, category_id)

    delete_response = test_client.delete(
        f"/api/v1/budgets/{budget['id']}",
        headers=_auth_headers(token),
    )
    assert delete_response.status_code == 204

    get_response = test_client.get(
        f"/api/v1/budgets/{budget['id']}",
        headers=_auth_headers(token),
    )
    assert get_response.status_code == 404


def test_set_month_override(test_client) -> None:
    """
    POST /api/v1/budgets/{id}/overrides should upsert a month override.
    Calling it twice for the same month should update the existing override
    (not create a duplicate).
    """
    token, _, category_id = _setup(test_client)
    budget = _create_budget(test_client, token, category_id, default_amount="100.00")

    # First override for January
    response1 = test_client.post(
        f"/api/v1/budgets/{budget['id']}/overrides",
        json={"month": 1, "amount": "200.00"},
        headers=_auth_headers(token),
    )
    assert response1.status_code == 201
    overrides = response1.json()["overrides"]
    assert len(overrides) == 1
    assert overrides[0]["amount"] == "200.00"

    # Upsert the same month — should update, not create a second
    response2 = test_client.post(
        f"/api/v1/budgets/{budget['id']}/overrides",
        json={"month": 1, "amount": "300.00"},
        headers=_auth_headers(token),
    )
    assert response2.status_code == 201
    overrides = response2.json()["overrides"]
    assert len(overrides) == 1
    assert overrides[0]["amount"] == "300.00"


# =============================================================================
# Plan integration tests
# =============================================================================


def test_plan_includes_budget_amounts(test_client) -> None:
    """
    A budget's default_amount should appear in the plan view's planned total
    for the corresponding category. Budget amounts and schedule amounts are
    additive — both contribute to planned.
    """
    token, _, category_id = _setup(test_client)

    _create_budget(
        test_client, token, category_id,
        year=2026,
        default_amount="250.00",
    )

    response = test_client.get("/api/v1/plan/2026/1", headers=_auth_headers(token))

    assert response.status_code == 200
    row = next(r for r in response.json()["rows"] if r["category_id"] == category_id)
    assert row["planned"] == "250.00"


def test_plan_uses_override_amount_when_set(test_client) -> None:
    """
    When a BudgetOverride exists for the target month, the plan view should
    use the override amount instead of the budget's default_amount.
    """
    token, _, category_id = _setup(test_client)

    budget = _create_budget(
        test_client, token, category_id,
        year=2026,
        default_amount="100.00",
    )

    # Override January to 400.00
    test_client.post(
        f"/api/v1/budgets/{budget['id']}/overrides",
        json={"month": 1, "amount": "400.00"},
        headers=_auth_headers(token),
    )

    response = test_client.get("/api/v1/plan/2026/1", headers=_auth_headers(token))

    assert response.status_code == 200
    row = next(r for r in response.json()["rows"] if r["category_id"] == category_id)
    # Should use the override (400), not the default (100)
    assert row["planned"] == "400.00"
