# tests/test_categories.py
#
# Purpose: Tests for the Categories endpoints and seeding behaviour.
#
# Test coverage:
#   - Seeding: registering a user creates the standard system categories
#   - CRUD: create, list, delete custom categories
#   - Hierarchy: creating a child category with a parent_category_id
#   - Protection: system categories cannot be deleted (403)
#   - Soft delete: deleted categories disappear from the list
#
# Each test gets a fresh SQLite database from conftest.py's test_client fixture.


# =============================================================================
# Helpers (same pattern as test_accounts.py)
# =============================================================================


def _register_and_login(
    test_client,
    email: str = "ginny@example.com",
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


# =============================================================================
# Seeding
# =============================================================================


def test_register_seeds_default_categories(test_client) -> None:
    """
    Registering a new user should automatically create their default system
    categories. We verify this by listing categories immediately after
    registration and checking that the expected names are present.

    The total seeded count is 34 (13 parents + 21 children). We check a
    representative sample rather than asserting the exact count, so the test
    remains valid if the seed list is extended in the future.
    """
    token = _register_and_login(test_client)

    response = test_client.get("/api/v1/categories", headers=_auth_headers(token))

    assert response.status_code == 200
    body = response.json()

    names = {c["name"] for c in body}

    # Check a spread of parent and child categories
    assert "Food & Drink" in names
    assert "Groceries" in names
    assert "Transport" in names
    assert "Public Transport" in names
    assert "Income" in names
    assert "Salary" in names

    # All seeded categories should be marked as system categories
    assert all(c["is_system"] for c in body), "All seeded categories should have is_system=True"

    # Sanity check the volume
    assert len(body) >= 30


# =============================================================================
# Create
# =============================================================================


def test_create_custom_category_returns_201(test_client) -> None:
    """
    Creating a category with a name should return 201 with the new category.
    is_system must be False — users cannot create system categories.
    """
    token = _register_and_login(test_client)

    response = test_client.post(
        "/api/v1/categories",
        json={"name": "Side Hustle"},
        headers=_auth_headers(token),
    )

    assert response.status_code == 201

    body = response.json()
    assert body["name"] == "Side Hustle"
    assert body["is_system"] is False
    assert "id" in body
    assert "user_id" in body
    assert "created_at" in body
    assert body["parent_category_id"] is None


def test_create_child_category_with_parent_id(test_client) -> None:
    """
    Creating a category with a parent_category_id should set the hierarchical
    relationship. The response should echo back the parent_category_id.
    """
    token = _register_and_login(test_client)

    parent = test_client.post(
        "/api/v1/categories",
        json={"name": "Business"},
        headers=_auth_headers(token),
    )
    parent_id = parent.json()["id"]

    child = test_client.post(
        "/api/v1/categories",
        json={"name": "Invoicing", "parent_category_id": parent_id},
        headers=_auth_headers(token),
    )

    assert child.status_code == 201
    assert child.json()["parent_category_id"] == parent_id
    assert child.json()["name"] == "Invoicing"


# =============================================================================
# List
# =============================================================================


def test_list_categories_returns_flat_list(test_client) -> None:
    """
    GET /api/v1/categories returns all non-deleted categories for the current
    user as a flat list. The list includes both system and custom categories.
    """
    token = _register_and_login(test_client)

    # Add a custom category on top of the seeded ones
    test_client.post(
        "/api/v1/categories",
        json={"name": "Custom"},
        headers=_auth_headers(token),
    )

    response = test_client.get("/api/v1/categories", headers=_auth_headers(token))

    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)

    names = {c["name"] for c in body}
    assert "Custom" in names          # our custom category is present
    assert "Food & Drink" in names    # system categories are present too


# =============================================================================
# Delete
# =============================================================================


def test_cannot_delete_system_category(test_client) -> None:
    """
    Attempting to DELETE a system category should return 403 Forbidden.
    """
    token = _register_and_login(test_client)

    # Registration seeds system categories — pick the first one
    categories = test_client.get(
        "/api/v1/categories",
        headers=_auth_headers(token),
    ).json()
    system_cat = next(c for c in categories if c["is_system"])

    response = test_client.delete(
        f"/api/v1/categories/{system_cat['id']}",
        headers=_auth_headers(token),
    )

    assert response.status_code == 403


def test_can_delete_custom_category(test_client) -> None:
    """
    DELETE on a custom (non-system) category should return 204 No Content.
    """
    token = _register_and_login(test_client)

    create_response = test_client.post(
        "/api/v1/categories",
        json={"name": "Temporary"},
        headers=_auth_headers(token),
    )
    cat_id = create_response.json()["id"]

    response = test_client.delete(
        f"/api/v1/categories/{cat_id}",
        headers=_auth_headers(token),
    )

    assert response.status_code == 204


# =============================================================================
# Visibility (is_hidden)
# =============================================================================


def test_categories_hidden_by_default_excluded_from_list(test_client) -> None:
    """
    A category with is_hidden=True should not appear in the default list.
    Default GET /api/v1/categories excludes hidden categories.
    """
    token = _register_and_login(test_client)

    # Create a category and hide it via the toggle endpoint
    create_response = test_client.post(
        "/api/v1/categories",
        json={"name": "Hidden Category"},
        headers=_auth_headers(token),
    )
    cat_id = create_response.json()["id"]

    test_client.patch(
        f"/api/v1/categories/{cat_id}/toggle-visibility",
        headers=_auth_headers(token),
    )

    # Default list should not include the hidden category
    response = test_client.get("/api/v1/categories", headers=_auth_headers(token))
    names = {c["name"] for c in response.json()}

    assert "Hidden Category" not in names


def test_include_hidden_query_param_returns_all(test_client) -> None:
    """
    GET /api/v1/categories?include_hidden=true should return hidden categories
    alongside visible ones.
    """
    token = _register_and_login(test_client)

    create_response = test_client.post(
        "/api/v1/categories",
        json={"name": "Hidden Category"},
        headers=_auth_headers(token),
    )
    cat_id = create_response.json()["id"]

    test_client.patch(
        f"/api/v1/categories/{cat_id}/toggle-visibility",
        headers=_auth_headers(token),
    )

    # With include_hidden=true the category should appear
    response = test_client.get(
        "/api/v1/categories?include_hidden=true",
        headers=_auth_headers(token),
    )
    names = {c["name"] for c in response.json()}

    assert "Hidden Category" in names


def test_toggle_visibility_hides_category_and_children(test_client) -> None:
    """
    Toggling a visible parent category sets is_hidden=True on the parent and
    all its direct children.
    """
    token = _register_and_login(test_client)

    # Create a parent and a child
    parent = test_client.post(
        "/api/v1/categories",
        json={"name": "Parent"},
        headers=_auth_headers(token),
    ).json()
    child = test_client.post(
        "/api/v1/categories",
        json={"name": "Child", "parent_category_id": parent["id"]},
        headers=_auth_headers(token),
    ).json()

    # Toggle the parent — should hide parent and child
    response = test_client.patch(
        f"/api/v1/categories/{parent['id']}/toggle-visibility",
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    assert response.json()["is_hidden"] is True

    # Child should also be hidden — check via include_hidden=true
    all_cats = test_client.get(
        "/api/v1/categories?include_hidden=true",
        headers=_auth_headers(token),
    ).json()
    child_data = next(c for c in all_cats if c["id"] == child["id"])
    assert child_data["is_hidden"] is True


def test_toggle_visibility_unhides_category_and_children(test_client) -> None:
    """
    Toggling a hidden parent category sets is_hidden=False on the parent and
    all its direct children (i.e. toggling twice restores visibility).
    """
    token = _register_and_login(test_client)

    parent = test_client.post(
        "/api/v1/categories",
        json={"name": "Parent"},
        headers=_auth_headers(token),
    ).json()
    child = test_client.post(
        "/api/v1/categories",
        json={"name": "Child", "parent_category_id": parent["id"]},
        headers=_auth_headers(token),
    ).json()

    parent_id = parent["id"]

    # Hide then unhide
    test_client.patch(
        f"/api/v1/categories/{parent_id}/toggle-visibility",
        headers=_auth_headers(token),
    )
    response = test_client.patch(
        f"/api/v1/categories/{parent_id}/toggle-visibility",
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    assert response.json()["is_hidden"] is False

    # Child should also be unhidden
    all_cats = test_client.get(
        "/api/v1/categories?include_hidden=true",
        headers=_auth_headers(token),
    ).json()
    child_data = next(c for c in all_cats if c["id"] == child["id"])
    assert child_data["is_hidden"] is False


def test_deleted_category_does_not_appear_in_list(test_client) -> None:
    """
    After soft-deleting a custom category, it should no longer appear in the
    list response. System categories are still present.
    """
    token = _register_and_login(test_client)

    create_response = test_client.post(
        "/api/v1/categories",
        json={"name": "To Be Deleted"},
        headers=_auth_headers(token),
    )
    cat_id = create_response.json()["id"]

    test_client.delete(
        f"/api/v1/categories/{cat_id}",
        headers=_auth_headers(token),
    )

    response = test_client.get("/api/v1/categories", headers=_auth_headers(token))
    names = {c["name"] for c in response.json()}

    assert "To Be Deleted" not in names
    assert "Food & Drink" in names  # system categories unaffected
