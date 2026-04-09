# tests/test_transactions.py
#
# Purpose: Tests for the Transactions endpoints.
#
# Test coverage:
#   - Create: expense returns 201 with correct fields
#   - Auth: missing JWT returns 401
#   - Data scoping: users only see their own transactions
#   - Filtering: by account_id, by status (comma-separated)
#   - Status semantics: only cleared + reconciled count toward actual spend
#   - Transfers: POST /transfer creates two linked rows atomically
#   - Refunds: parent_transaction_id links refund to original expense
#   - Soft delete: DELETE returns 204, subsequent GET returns 404
#
# Pattern: same helpers as test_accounts.py and test_categories.py.
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
    """Return the id of the first seeded system category.

    Registration seeds a set of default categories automatically, so there is
    always at least one available without needing to create a custom one.
    """
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


# A minimal valid transaction payload — missing account_id and category_id,
# which must be added per-test since they are created dynamically.
_TXN = {
    "date": "2026-01-15",
    "amount": "42.50",
    "transaction_type": "expense",
}


# =============================================================================
# Create transaction
# =============================================================================


def test_create_expense_returns_201(test_client) -> None:
    """
    Creating a valid expense transaction should return 201 with the expected
    fields. Defaults: status=pending, currency=GBP.
    """
    token, account_id, category_id = _setup(test_client)

    response = test_client.post(
        "/api/v1/transactions",
        json={**_TXN, "account_id": account_id, "category_id": category_id},
        headers=_auth_headers(token),
    )

    assert response.status_code == 201

    body = response.json()
    assert body["amount"] == "42.50"
    assert body["transaction_type"] == "expense"
    assert body["status"] == "pending"        # server default
    assert body["currency"] == "GBP"          # server default
    assert body["account_id"] == account_id
    assert body["category_id"] == category_id
    assert "id" in body
    assert "user_id" in body
    assert "created_at" in body
    assert body["parent_transaction_id"] is None
    # category_name is denormalised from the Category row
    assert "category_name" in body
    assert isinstance(body["category_name"], str)


def test_create_transaction_without_auth_returns_401(test_client) -> None:
    """Posting without an Authorization header should return 401."""
    response = test_client.post(
        "/api/v1/transactions",
        json={**_TXN, "account_id": "00000000-0000-0000-0000-000000000001",
              "category_id": "00000000-0000-0000-0000-000000000002"},
    )
    assert response.status_code == 401


# =============================================================================
# List transactions
# =============================================================================


def test_list_transactions_returns_only_current_users_transactions(test_client) -> None:
    """
    Each user must only see their own transactions.

    We create one transaction per user and assert each user's list contains
    exactly one transaction — their own.
    """
    token_a, account_a, cat_a = _setup(test_client, "user_a@example.com")
    token_b, account_b, cat_b = _setup(test_client, "user_b@example.com")

    test_client.post(
        "/api/v1/transactions",
        json={**_TXN, "account_id": account_a, "category_id": cat_a, "payee": "Shop A"},
        headers=_auth_headers(token_a),
    )
    test_client.post(
        "/api/v1/transactions",
        json={**_TXN, "account_id": account_b, "category_id": cat_b, "payee": "Shop B"},
        headers=_auth_headers(token_b),
    )

    response = test_client.get("/api/v1/transactions", headers=_auth_headers(token_a))

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["payee"] == "Shop A"


def test_list_transactions_can_filter_by_account(test_client) -> None:
    """
    GET /api/v1/transactions?account_id=<id> should return only transactions
    belonging to that account. Transactions on other accounts are excluded.
    """
    token, _, category_id = _setup(test_client)

    account_a = _create_account(test_client, token, name="Account A")
    account_b = _create_account(test_client, token, name="Account B")

    test_client.post(
        "/api/v1/transactions",
        json={**_TXN, "account_id": account_a, "category_id": category_id, "payee": "Shop A"},
        headers=_auth_headers(token),
    )
    test_client.post(
        "/api/v1/transactions",
        json={**_TXN, "account_id": account_b, "category_id": category_id, "payee": "Shop B"},
        headers=_auth_headers(token),
    )

    response = test_client.get(
        f"/api/v1/transactions?account_id={account_a}",
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["payee"] == "Shop A"


def test_only_cleared_and_reconciled_count_toward_actual_spend(test_client) -> None:
    """
    GET /api/v1/transactions?status=cleared,reconciled should return only
    cleared and reconciled transactions — not pending ones.

    This filter is what the budget engine will use to compute "actual spend".
    A pending transaction is expected but not yet settled, so it must not
    inflate the amount already spent in a budget period.
    """
    token, account_id, category_id = _setup(test_client)

    base = {**_TXN, "account_id": account_id, "category_id": category_id}

    test_client.post(
        "/api/v1/transactions",
        json={**base, "status": "pending"},
        headers=_auth_headers(token),
    )
    test_client.post(
        "/api/v1/transactions",
        json={**base, "status": "cleared"},
        headers=_auth_headers(token),
    )
    test_client.post(
        "/api/v1/transactions",
        json={**base, "status": "reconciled"},
        headers=_auth_headers(token),
    )

    response = test_client.get(
        "/api/v1/transactions?status=cleared,reconciled",
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 2
    returned_statuses = {t["status"] for t in body}
    assert returned_statuses == {"cleared", "reconciled"}


# =============================================================================
# Transfer
# =============================================================================


def test_create_transfer_creates_two_linked_transactions(test_client) -> None:
    """
    POST /api/v1/transactions/transfer should atomically create two Transaction
    rows — one debit (from_account) and one credit (to_account) — and link
    them via parent_transaction_id.

    Verifications:
      - Response contains exactly 2 transactions
      - Both have transaction_type = "transfer"
      - Exactly one has parent_transaction_id = None (the debit/parent)
      - The other's parent_transaction_id equals the first one's id
    """
    token, _, category_id = _setup(test_client)

    account_from = _create_account(test_client, token, name="From Account")
    account_to = _create_account(test_client, token, name="To Account")

    response = test_client.post(
        "/api/v1/transactions/transfer",
        json={
            "from_account_id": account_from,
            "to_account_id": account_to,
            "category_id": category_id,
            "date": "2026-01-15",
            "amount": "200.00",
        },
        headers=_auth_headers(token),
    )

    assert response.status_code == 201

    body = response.json()
    assert len(body) == 2

    # Both legs must be tagged as transfers
    types = {t["transaction_type"] for t in body}
    assert types == {"transfer"}

    # Identify parent and child legs by their parent_transaction_id
    parent_leg = next(t for t in body if t["parent_transaction_id"] is None)
    child_leg = next(t for t in body if t["parent_transaction_id"] is not None)

    # The child must point at the parent — not at itself, not at a random id
    assert child_leg["parent_transaction_id"] == parent_leg["id"], (
        "Child leg's parent_transaction_id must equal the parent leg's id"
    )
    # Sanity: the parent must not reference itself
    assert parent_leg["id"] != child_leg["id"]


# =============================================================================
# Refund
# =============================================================================


def test_create_refund_links_to_parent_transaction(test_client) -> None:
    """
    A refund transaction should have parent_transaction_id set to the id of
    the original expense it is refunding.

    This link is how the budget engine identifies refunds and reduces category
    spend accordingly (rather than double-counting refunds as negative expenses).
    """
    token, account_id, category_id = _setup(test_client)

    base = {"account_id": account_id, "category_id": category_id, "date": "2026-01-10"}

    # Create the original expense
    expense_response = test_client.post(
        "/api/v1/transactions",
        json={**base, "amount": "80.00", "transaction_type": "expense"},
        headers=_auth_headers(token),
    )
    assert expense_response.status_code == 201
    expense_id = expense_response.json()["id"]

    # Create a refund that references the expense
    refund_response = test_client.post(
        "/api/v1/transactions",
        json={
            **base,
            "amount": "80.00",
            "transaction_type": "refund",
            "parent_transaction_id": expense_id,
        },
        headers=_auth_headers(token),
    )

    assert refund_response.status_code == 201
    body = refund_response.json()
    assert body["transaction_type"] == "refund"
    assert body["parent_transaction_id"] == expense_id


# =============================================================================
# Soft delete
# =============================================================================


def test_delete_transaction_is_soft_delete(test_client) -> None:
    """
    DELETE /api/v1/transactions/{id} should return 204 and make the transaction
    invisible through the API (GET returns 404). The row is NOT physically
    deleted — deleted_at is set instead (soft delete).
    """
    token, account_id, category_id = _setup(test_client)

    create_response = test_client.post(
        "/api/v1/transactions",
        json={**_TXN, "account_id": account_id, "category_id": category_id},
        headers=_auth_headers(token),
    )
    assert create_response.status_code == 201
    transaction_id = create_response.json()["id"]

    delete_response = test_client.delete(
        f"/api/v1/transactions/{transaction_id}",
        headers=_auth_headers(token),
    )
    assert delete_response.status_code == 204

    # The transaction should now be invisible through the API
    get_response = test_client.get(
        f"/api/v1/transactions/{transaction_id}",
        headers=_auth_headers(token),
    )
    assert get_response.status_code == 404
