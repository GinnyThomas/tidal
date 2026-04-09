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


def test_seeded_categories_have_correct_parent_child_relationships(test_client) -> None:
    """
    After registration, every child category's parent_category_id must point to
    the correct parent category in the same user's list.

    --- Why this test exists (the UUID seeding bug) ---

    SQLAlchemy model columns can declare a `default=` callable, e.g.:
        id = Column(Uuid, default=uuid.uuid4)

    The bug: if you write `default=uuid.uuid4` (no call brackets), SQLAlchemy
    stores a *reference* to the function and calls it once per row at INSERT
    time. But if you pre-build Category objects in Python and try to reference
    `parent.id` before the session has flushed, you need the id to already be
    set in memory — and SQLAlchemy's default machinery only runs on flush, not
    on construction.

    The original broken code did:
        Category(name="Groceries", parent_category_id=food.id)
    expecting `food.id` to be populated. If the model default hadn't been
    triggered yet, `food.id` was None — so every child got `parent_category_id=None`
    and the hierarchy was silently destroyed.

    The fix in services/categories.py passes the id explicitly:
        cat(...) returns Category(id=uuid.uuid4(), ...)
    This calls uuid.uuid4() *at construction time* in Python, so parent.id is
    always a real UUID before any child object is created. No DB round-trip needed.

    This test catches any future regression where that explicit id= is removed or
    where the seeding order is changed in a way that breaks parent references.
    """
    token = _register_and_login(test_client)

    # include_hidden=true to get the full seeded set regardless of visibility
    response = test_client.get(
        "/api/v1/categories?include_hidden=true",
        headers=_auth_headers(token),
    )
    assert response.status_code == 200

    categories = response.json()

    # Name → category dict for readable assertions below
    by_name = {c["name"]: c for c in categories}

    # --- Assert specific child → parent relationships ---
    #
    # We check a spread across different parent groups rather than every pair.
    # This is enough to catch the UUID bug (if ids were wrong, ALL children
    # would be broken, not just a subset) while keeping the test concise.
    expected_pairs = [
        ("Groceries",        "Food & Drink"),
        ("Eating Out",       "Food & Drink"),
        ("Takeaway",         "Food & Drink"),
        ("Rent/Mortgage",    "Household"),
        ("Utilities",        "Household"),
        ("Public Transport", "Transport"),
        ("Fuel",             "Transport"),
        ("Streaming",        "Entertainment"),
        ("Medical",          "Health"),
        ("Clothing",         "Personal"),
        ("Bank Fees",        "Banking & Finance"),
        ("Salary",           "Income"),
        ("Freelance",        "Income"),
    ]

    for child_name, parent_name in expected_pairs:
        child = by_name[child_name]
        parent = by_name[parent_name]

        assert child["parent_category_id"] is not None, (
            f"'{child_name}' has parent_category_id=None — "
            f"expected it to point to '{parent_name}'"
        )
        assert child["parent_category_id"] == parent["id"], (
            f"'{child_name}'.parent_category_id is {child['parent_category_id']!r} "
            f"but '{parent_name}'.id is {parent['id']!r} — IDs don't match"
        )

    # --- Assert all 13 top-level categories have no parent ---
    #
    # If the UUID bug were present in reverse (children stored with a made-up
    # parent id that doesn't exist), the parent rows themselves would still have
    # parent_category_id=None — so this guards the other direction.
    top_level_names = {
        "Food & Drink", "Household", "Transport", "Entertainment", "Health",
        "Personal", "Phone & Internet", "Banking & Finance", "Education",
        "Savings", "Gifts & Celebrations", "Travel", "Income",
    }
    for name in top_level_names:
        assert by_name[name]["parent_category_id"] is None, (
            f"Top-level category '{name}' should have parent_category_id=None, "
            f"got {by_name[name]['parent_category_id']!r}"
        )


# =============================================================================
# Edit (Fix 1 — system categories can be edited)
# =============================================================================


def test_can_edit_system_category_name_colour_icon(test_client) -> None:
    """
    PUT on a system category should succeed (200) and return the updated values.

    System categories can be renamed or have their colour/icon changed so users
    can personalise them. Only DELETE is blocked for system categories.
    """
    token = _register_and_login(test_client)

    categories = test_client.get(
        "/api/v1/categories", headers=_auth_headers(token)
    ).json()
    system_cat = next(c for c in categories if c["is_system"])

    new_name = f"Custom {system_cat['name']}"
    response = test_client.put(
        f"/api/v1/categories/{system_cat['id']}",
        json={"name": new_name, "colour": "#ff5733", "icon": "⭐"},
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == new_name
    assert body["colour"] == "#ff5733"
    assert body["icon"] == "⭐"
    # Editing does not change is_system — it should still be True
    assert body["is_system"] is True


# =============================================================================
# Duplicate name protection (Fix 2)
# =============================================================================


def test_cannot_create_duplicate_category_name(test_client) -> None:
    """
    Creating a category whose name already exists (non-deleted) for the same
    user should return 422.

    This applies to both custom and system categories — "Food & Drink" is a
    system category seeded on registration, so trying to create a custom
    category with that name should also fail.
    """
    token = _register_and_login(test_client)

    # First creation succeeds
    first = test_client.post(
        "/api/v1/categories",
        json={"name": "Hobbies"},
        headers=_auth_headers(token),
    )
    assert first.status_code == 201

    # Second with identical name fails
    second = test_client.post(
        "/api/v1/categories",
        json={"name": "Hobbies"},
        headers=_auth_headers(token),
    )
    assert second.status_code == 422
    assert "already exists" in second.json()["detail"]


def test_cannot_update_category_to_duplicate_name(test_client) -> None:
    """
    Renaming a category to a name that already belongs to another non-deleted
    category for the same user should return 422.

    Updating a category to keep its own current name (no-op rename) must still
    succeed — the duplicate check excludes the category being updated.
    """
    token = _register_and_login(test_client)

    alpha = test_client.post(
        "/api/v1/categories",
        json={"name": "Alpha"},
        headers=_auth_headers(token),
    ).json()
    test_client.post(
        "/api/v1/categories",
        json={"name": "Beta"},
        headers=_auth_headers(token),
    )

    # Renaming Alpha → Beta collides with the existing Beta category
    response = test_client.put(
        f"/api/v1/categories/{alpha['id']}",
        json={"name": "Beta"},
        headers=_auth_headers(token),
    )
    assert response.status_code == 422
    assert "already exists" in response.json()["detail"]

    # Renaming Alpha → Alpha (no-op) must succeed
    noop = test_client.put(
        f"/api/v1/categories/{alpha['id']}",
        json={"name": "Alpha"},
        headers=_auth_headers(token),
    )
    assert noop.status_code == 200


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
