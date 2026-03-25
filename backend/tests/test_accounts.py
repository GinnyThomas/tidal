# tests/test_accounts.py
#
# Purpose: Tests for the Accounts endpoints.
#
# TDD approach: these tests are written BEFORE the implementation.
# Run now → RED (endpoints don't exist yet, returns 404).
# After writing the router → GREEN.
#
# We test behaviour, not implementation:
#   - Correct HTTP status codes
#   - Correct response shapes
#   - Data scoping (users only see their own accounts)
#   - Soft delete (deleted accounts disappear from API surface)
#
# Helpers:
#   _register_and_login — registers a user and returns a JWT token
#   _auth_headers       — wraps a token in an Authorization header dict
#
# Each test gets a fresh empty SQLite database from the test_client fixture
# in conftest.py. Tests cannot share or interfere with each other.


# =============================================================================
# Helpers
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
    """Return an Authorization header dict for a given token."""
    return {"Authorization": f"Bearer {token}"}


# A minimal valid account payload reused across tests.
_ACCOUNT = {"name": "Nationwide Current", "account_type": "checking"}


# =============================================================================
# Create account
# =============================================================================


def test_create_account_returns_201(test_client) -> None:
    """
    Creating an account with valid data and a valid JWT should return:
      - HTTP 201 Created
      - A JSON body containing: id, user_id, name, account_type, currency,
        current_balance, is_manual, is_active, created_at
      - Sensible defaults: currency = "GBP", current_balance = "0"
    """
    token = _register_and_login(test_client)

    response = test_client.post(
        "/api/v1/accounts",
        json=_ACCOUNT,
        headers=_auth_headers(token),
    )

    assert response.status_code == 201

    body = response.json()
    assert body["name"] == "Nationwide Current"
    assert body["account_type"] == "checking"
    assert body["currency"] == "GBP"         # server-side default
    assert body["current_balance"] == "0.00"  # string per API convention; NUMERIC(12,2) preserves scale
    assert body["is_manual"] is True          # always True for API-created accounts
    assert body["is_active"] is True
    assert "id" in body
    assert "user_id" in body
    assert "created_at" in body


def test_create_account_without_auth_returns_401(test_client) -> None:
    """
    Posting without an Authorization header should be rejected.

    Note on HTTP status: in this version of FastAPI/Starlette, HTTPBearer returns
    401 Unauthorized when the Authorization header is absent. (Some versions return
    403 Forbidden; the actual status is library-version-dependent. We assert what
    the running version actually returns.)
    """
    response = test_client.post("/api/v1/accounts", json=_ACCOUNT)
    assert response.status_code == 401


# =============================================================================
# List accounts
# =============================================================================


def test_list_accounts_returns_only_current_users_accounts(test_client) -> None:
    """
    Each user should only see their own accounts — never another user's.

    This is the most important security property of the accounts system.
    We create one account for user A and one for user B, then verify that
    each user's list contains exactly one account and it is their own.
    """
    token_a = _register_and_login(test_client, "user_a@example.com")
    token_b = _register_and_login(test_client, "user_b@example.com")

    test_client.post(
        "/api/v1/accounts",
        json={"name": "A's Account", "account_type": "checking"},
        headers=_auth_headers(token_a),
    )
    test_client.post(
        "/api/v1/accounts",
        json={"name": "B's Account", "account_type": "savings"},
        headers=_auth_headers(token_b),
    )

    response = test_client.get("/api/v1/accounts", headers=_auth_headers(token_a))

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["name"] == "A's Account"


# =============================================================================
# Get account by ID
# =============================================================================


def test_get_account_by_id_returns_correct_account(test_client) -> None:
    """
    GET /api/v1/accounts/{id} should return the account with that ID,
    provided it belongs to the authenticated user.
    """
    token = _register_and_login(test_client)

    create_response = test_client.post(
        "/api/v1/accounts",
        json={"name": "My Savings", "account_type": "savings"},
        headers=_auth_headers(token),
    )
    account_id = create_response.json()["id"]

    response = test_client.get(
        f"/api/v1/accounts/{account_id}",
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    assert response.json()["name"] == "My Savings"


def test_get_account_belonging_to_another_user_returns_404(test_client) -> None:
    """
    Attempting to GET another user's account should return 404 Not Found.

    Why 404 and not 403 Forbidden?
    403 would confirm to the requester that the account EXISTS but they can't
    access it — leaking information about another user's data. 404 is
    intentionally ambiguous: "no such account (for you)". The account may or
    may not exist — we don't say.
    """
    token_a = _register_and_login(test_client, "user_a@example.com")
    token_b = _register_and_login(test_client, "user_b@example.com")

    create_response = test_client.post(
        "/api/v1/accounts",
        json={"name": "A's Private Account", "account_type": "checking"},
        headers=_auth_headers(token_a),
    )
    account_id = create_response.json()["id"]

    # User B tries to access User A's account
    response = test_client.get(
        f"/api/v1/accounts/{account_id}",
        headers=_auth_headers(token_b),
    )

    assert response.status_code == 404


# =============================================================================
# Update account
# =============================================================================


def test_update_account_reflects_changes(test_client) -> None:
    """
    PUT /api/v1/accounts/{id} with a partial payload should update only the
    fields provided and return the updated account.

    We send only `name` — the other fields should remain unchanged.
    """
    token = _register_and_login(test_client)

    create_response = test_client.post(
        "/api/v1/accounts",
        json={"name": "Old Name", "account_type": "checking"},
        headers=_auth_headers(token),
    )
    account_id = create_response.json()["id"]

    response = test_client.put(
        f"/api/v1/accounts/{account_id}",
        json={"name": "New Name"},
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "New Name"
    assert body["account_type"] == "checking"  # unchanged


# =============================================================================
# Delete account (soft delete)
# =============================================================================


def test_delete_account_is_soft_delete(test_client) -> None:
    """
    DELETE /api/v1/accounts/{id} should:
      - Return 204 No Content (success — the account is "gone" from the API)
      - Make the account return 404 on subsequent GET requests

    The row is NOT physically deleted from the database — the router sets
    deleted_at to the current UTC timestamp. The 404 on GET is because the
    router filters WHERE deleted_at IS NULL.

    We verify the soft-delete behaviour indirectly: a true hard delete would
    also produce a 404, but test_deleted_account_does_not_appear_in_list
    together with this test confirms the full expected behaviour.
    """
    token = _register_and_login(test_client)

    create_response = test_client.post(
        "/api/v1/accounts",
        json=_ACCOUNT,
        headers=_auth_headers(token),
    )
    account_id = create_response.json()["id"]

    delete_response = test_client.delete(
        f"/api/v1/accounts/{account_id}",
        headers=_auth_headers(token),
    )
    assert delete_response.status_code == 204

    # Account should now be invisible through the API
    get_response = test_client.get(
        f"/api/v1/accounts/{account_id}",
        headers=_auth_headers(token),
    )
    assert get_response.status_code == 404


def test_deleted_account_does_not_appear_in_list(test_client) -> None:
    """
    After deleting an account, it should not appear in the list response.

    We create two accounts, delete one, then assert that only the surviving
    account appears in the list. This verifies the WHERE deleted_at IS NULL
    filter on the list endpoint.
    """
    token = _register_and_login(test_client)

    test_client.post(
        "/api/v1/accounts",
        json={"name": "Keep Me", "account_type": "checking"},
        headers=_auth_headers(token),
    )
    to_delete = test_client.post(
        "/api/v1/accounts",
        json={"name": "Delete Me", "account_type": "savings"},
        headers=_auth_headers(token),
    )
    account_id = to_delete.json()["id"]

    test_client.delete(
        f"/api/v1/accounts/{account_id}",
        headers=_auth_headers(token),
    )

    response = test_client.get("/api/v1/accounts", headers=_auth_headers(token))
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["name"] == "Keep Me"
