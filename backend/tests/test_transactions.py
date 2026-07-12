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


def test_create_expense_rejects_negative_amount(test_client) -> None:
    """
    amount must be a non-negative magnitude at the schema level — direction
    comes from transaction_type/account_type (see _calculate_balance in
    routers/accounts.py), never from the sign of amount. This was previously
    enforced only by convention (the frontend's <input min="0">), which is
    exactly how the CSV-import signed-amount bug slipped through undetected.
    """
    token, account_id, category_id = _setup(test_client)

    response = test_client.post(
        "/api/v1/transactions",
        json={**_TXN, "account_id": account_id, "category_id": category_id, "amount": "-42.50"},
        headers=_auth_headers(token),
    )
    assert response.status_code == 422


def test_update_transaction_rejects_negative_amount(test_client) -> None:
    """PUT must reject a negative amount the same way POST does."""
    token, account_id, category_id = _setup(test_client)

    expense = test_client.post(
        "/api/v1/transactions",
        json={**_TXN, "account_id": account_id, "category_id": category_id},
        headers=_auth_headers(token),
    ).json()

    response = test_client.put(
        f"/api/v1/transactions/{expense['id']}",
        json={"amount": "-10.00"},
        headers=_auth_headers(token),
    )
    assert response.status_code == 422


def test_create_transfer_rejects_negative_amount(test_client) -> None:
    """POST /transfer must reject a negative amount the same way expense/income do."""
    token, account_id, _ = _setup(test_client)
    other_account = _create_account(test_client, token, name="Other")

    response = test_client.post(
        "/api/v1/transactions/transfer",
        json={
            "from_account_id": account_id, "to_account_id": other_account,
            "date": "2026-01-15", "amount": "-200.00",
        },
        headers=_auth_headers(token),
    )
    assert response.status_code == 422


def test_create_split_rejects_negative_split_amount(test_client) -> None:
    """A negative amount on an individual split must be rejected at the schema level."""
    token, account_id, category_id = _setup(test_client)

    response = test_client.post(
        "/api/v1/transactions",
        json={
            "account_id": account_id, "date": "2026-01-15", "amount": "100.00",
            "transaction_type": "expense",
            "splits": [
                {"category_id": category_id, "amount": "-60.00"},
                {"category_id": category_id, "amount": "160.00"},
            ],
        },
        headers=_auth_headers(token),
    )
    assert response.status_code == 422


def test_create_transaction_without_auth_returns_401(test_client) -> None:
    """Posting without an Authorization header should return 401."""
    response = test_client.post(
        "/api/v1/transactions",
        json={**_TXN, "account_id": "00000000-0000-0000-0000-000000000001",
              "category_id": "00000000-0000-0000-0000-000000000002"},
    )
    assert response.status_code == 401


def test_create_expense_without_category_succeeds(test_client) -> None:
    """
    Creating an expense without category_id should succeed (201).
    category_id is optional for all transaction types — allows uncategorised
    transactions like credit card payments.
    """
    token, account_id, _ = _setup(test_client)

    response = test_client.post(
        "/api/v1/transactions",
        json={
            "account_id": account_id,
            "date": "2026-01-15",
            "amount": "42.50",
            "transaction_type": "expense",
        },
        headers=_auth_headers(token),
    )
    assert response.status_code == 201
    assert response.json()["category_id"] is None
    assert response.json()["category_name"] is None


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
    assert body["total"] == 1
    assert body["items"][0]["payee"] == "Shop A"


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
    assert body["total"] == 1
    assert body["items"][0]["payee"] == "Shop A"


def test_list_transactions_can_filter_by_category(test_client) -> None:
    """
    GET /api/v1/transactions?category_id=<id> should return only transactions
    belonging to that category. Transactions in other categories are excluded.

    This powers the category drill-down feature: clicking a category name
    navigates to /transactions?category_id=<uuid> so the user can see all
    spending in that category.
    """
    token, account_id, _ = _setup(test_client)

    # Get two different category IDs from the seeded categories
    categories = test_client.get(
        "/api/v1/categories",
        headers=_auth_headers(token),
    ).json()
    category_a = categories[0]["id"]
    category_b = categories[1]["id"]

    test_client.post(
        "/api/v1/transactions",
        json={**_TXN, "account_id": account_id, "category_id": category_a, "payee": "Payee A"},
        headers=_auth_headers(token),
    )
    test_client.post(
        "/api/v1/transactions",
        json={**_TXN, "account_id": account_id, "category_id": category_b, "payee": "Payee B"},
        headers=_auth_headers(token),
    )

    response = test_client.get(
        f"/api/v1/transactions?category_id={category_a}",
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["payee"] == "Payee A"


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
    assert body["total"] == 2
    returned_statuses = {t["status"] for t in body["items"]}
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
# Convert to transfer
# =============================================================================


def test_convert_expense_to_transfer_links_two_legs(test_client) -> None:
    """
    POST /api/v1/transactions/{id}/convert-to-transfer on an expense mutates
    it in place into the debit (from) leg of a transfer, and creates a new
    credit (to) leg on the other account.

    The original transaction keeps its id (and therefore its dedup_hash /
    external_id, if any) — this is a conversion, not a delete-and-recreate.
    """
    token, account_id, category_id = _setup(test_client)
    other_account = _create_account(test_client, token, name="Savings")

    expense = test_client.post(
        "/api/v1/transactions",
        json={
            "account_id": account_id, "category_id": category_id,
            "date": "2026-01-15", "amount": "50.00", "transaction_type": "expense",
        },
        headers=_auth_headers(token),
    ).json()

    response = test_client.post(
        f"/api/v1/transactions/{expense['id']}/convert-to-transfer",
        json={"other_account_id": other_account},
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 2

    types = {t["transaction_type"] for t in body}
    assert types == {"transfer"}

    debit_leg = next(t for t in body if t["id"] == expense["id"])
    credit_leg = next(t for t in body if t["id"] != expense["id"])

    # The original row is the debit (from) leg — unchanged account, no parent
    assert debit_leg["account_id"] == account_id
    assert debit_leg["parent_transaction_id"] is None
    assert debit_leg["category_id"] is None
    assert debit_leg["amount"] == "50.00"

    # The new row is the credit (to) leg on the other account
    assert credit_leg["account_id"] == other_account
    assert credit_leg["parent_transaction_id"] == debit_leg["id"]
    assert credit_leg["amount"] == "50.00"


def test_convert_income_to_transfer_links_two_legs(test_client) -> None:
    """
    Converting an income transaction makes it the credit (to) leg, and
    creates a new debit (from) leg on the other account.
    """
    token, account_id, category_id = _setup(test_client)
    other_account = _create_account(test_client, token, name="Checking")

    income = test_client.post(
        "/api/v1/transactions",
        json={
            "account_id": account_id, "category_id": category_id,
            "date": "2026-01-15", "amount": "75.00", "transaction_type": "income",
        },
        headers=_auth_headers(token),
    ).json()

    response = test_client.post(
        f"/api/v1/transactions/{income['id']}/convert-to-transfer",
        json={"other_account_id": other_account},
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    body = response.json()

    credit_leg = next(t for t in body if t["id"] == income["id"])
    debit_leg = next(t for t in body if t["id"] != income["id"])

    # The original row is the credit (to) leg — points at the new debit leg
    assert credit_leg["account_id"] == account_id
    assert credit_leg["parent_transaction_id"] == debit_leg["id"]
    assert credit_leg["category_id"] is None

    # The new row is the debit (from) leg on the other account
    assert debit_leg["account_id"] == other_account
    assert debit_leg["parent_transaction_id"] is None


def test_convert_to_transfer_preserves_dedup_hash_and_external_id(test_client) -> None:
    """
    Converting a CSV-imported row must preserve its dedup_hash/external_id —
    re-importing the same CSV file afterwards should still detect it as a
    duplicate rather than creating an extra expense row.
    """
    token, account_id, _ = _setup(test_client)
    other_account = _create_account(test_client, token, name="Savings")

    test_client.post(
        "/api/v1/transactions/import",
        json={
            "account_id": account_id,
            "transactions": [{
                "date": "2026-01-15", "amount": "-30.00", "payee": "Internal Transfer",
                "external_id": "tx_abc123",
            }],
        },
        headers=_auth_headers(token),
    )
    imported = test_client.get(
        f"/api/v1/transactions?account_id={account_id}", headers=_auth_headers(token),
    ).json()["items"][0]

    response = test_client.post(
        f"/api/v1/transactions/{imported['id']}/convert-to-transfer",
        json={"other_account_id": other_account},
        headers=_auth_headers(token),
    )
    assert response.status_code == 200
    debit_leg = next(t for t in response.json() if t["id"] == imported["id"])
    assert debit_leg["dedup_hash"] == imported["dedup_hash"]
    assert debit_leg["external_id"] == "tx_abc123"


def test_convert_to_transfer_rejects_same_account(test_client) -> None:
    """The other account must differ from the transaction's own account."""
    token, account_id, category_id = _setup(test_client)

    expense = test_client.post(
        "/api/v1/transactions",
        json={
            "account_id": account_id, "category_id": category_id,
            "date": "2026-01-15", "amount": "50.00", "transaction_type": "expense",
        },
        headers=_auth_headers(token),
    ).json()

    response = test_client.post(
        f"/api/v1/transactions/{expense['id']}/convert-to-transfer",
        json={"other_account_id": account_id},
        headers=_auth_headers(token),
    )
    assert response.status_code == 422


def test_convert_to_transfer_rejects_transfer_type(test_client) -> None:
    """A transaction that is already a transfer leg cannot be converted again."""
    token, account_id, category_id = _setup(test_client)
    account_to = _create_account(test_client, token, name="To Account")
    account_other = _create_account(test_client, token, name="Other")

    transfer = test_client.post(
        "/api/v1/transactions/transfer",
        json={
            "from_account_id": account_id, "to_account_id": account_to,
            "date": "2026-01-15", "amount": "200.00",
        },
        headers=_auth_headers(token),
    ).json()

    response = test_client.post(
        f"/api/v1/transactions/{transfer[0]['id']}/convert-to-transfer",
        json={"other_account_id": account_other},
        headers=_auth_headers(token),
    )
    assert response.status_code == 422


def test_convert_to_transfer_rejects_refund_type(test_client) -> None:
    """Refunds are linked to their original expense and cannot be converted."""
    token, account_id, category_id = _setup(test_client)
    other_account = _create_account(test_client, token, name="Other")

    expense = test_client.post(
        "/api/v1/transactions",
        json={
            "account_id": account_id, "category_id": category_id,
            "date": "2026-01-10", "amount": "80.00", "transaction_type": "expense",
        },
        headers=_auth_headers(token),
    ).json()
    refund = test_client.post(
        "/api/v1/transactions",
        json={
            "account_id": account_id, "category_id": category_id,
            "date": "2026-01-10", "amount": "80.00", "transaction_type": "refund",
            "parent_transaction_id": expense["id"],
        },
        headers=_auth_headers(token),
    ).json()

    response = test_client.post(
        f"/api/v1/transactions/{refund['id']}/convert-to-transfer",
        json={"other_account_id": other_account},
        headers=_auth_headers(token),
    )
    assert response.status_code == 422


def test_convert_to_transfer_rejects_split_transaction(test_client) -> None:
    """Split transactions have no single category to clear and cannot be converted."""
    token, account_id, category_id = _setup(test_client)
    other_account = _create_account(test_client, token, name="Other")

    split_tx = test_client.post(
        "/api/v1/transactions",
        json={
            "account_id": account_id, "date": "2026-01-15", "amount": "100.00",
            "transaction_type": "expense",
            "splits": [
                {"category_id": category_id, "amount": "60.00"},
                {"category_id": category_id, "amount": "40.00"},
            ],
        },
        headers=_auth_headers(token),
    ).json()

    response = test_client.post(
        f"/api/v1/transactions/{split_tx['id']}/convert-to-transfer",
        json={"other_account_id": other_account},
        headers=_auth_headers(token),
    )
    assert response.status_code == 422


def test_convert_to_transfer_clears_promotion_id(test_client) -> None:
    """
    A transaction linked to a promotion (e.g. a 0%-APR balance transfer
    instalment) must have promotion_id cleared on conversion.

    _compute_fields() in promotions.py sums total_paid by promotion_id alone,
    across any transaction_type — it doesn't filter to expenses. If
    promotion_id survived the conversion, this row would keep counting
    toward the promotion's total_paid/remaining_balance even though it's now
    a transfer between the user's own accounts, not a payment. create_transfer
    never sets promotion_id on either leg, so a converted transaction must
    match that.
    """
    token, account_id, category_id = _setup(test_client)
    other_account = _create_account(test_client, token, name="Savings")

    promo_response = test_client.post(
        "/api/v1/promotions",
        json={
            "name": "0% Balance Transfer",
            "promotion_type": "balance_transfer",
            "original_balance": "2000.00",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
        },
        headers=_auth_headers(token),
    )
    assert promo_response.status_code == 201, promo_response.text
    promotion_id = promo_response.json()["id"]

    expense = test_client.post(
        "/api/v1/transactions",
        json={
            "account_id": account_id, "category_id": category_id,
            "date": "2026-01-15", "amount": "50.00", "transaction_type": "expense",
            "promotion_id": promotion_id,
        },
        headers=_auth_headers(token),
    ).json()
    assert expense["promotion_id"] == promotion_id

    response = test_client.post(
        f"/api/v1/transactions/{expense['id']}/convert-to-transfer",
        json={"other_account_id": other_account},
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    debit_leg = next(t for t in response.json() if t["id"] == expense["id"])
    assert debit_leg["promotion_id"] is None


def test_convert_to_transfer_rejects_other_users_account(test_client) -> None:
    """Cannot convert into a transfer targeting another user's account."""
    token_a, account_a, category_a = _setup(test_client, "a3@example.com")
    token_b = _register_and_login(test_client, "b3@example.com")
    account_b = _create_account(test_client, token_b, name="B's Account")

    expense = test_client.post(
        "/api/v1/transactions",
        json={
            "account_id": account_a, "category_id": category_a,
            "date": "2026-01-15", "amount": "50.00", "transaction_type": "expense",
        },
        headers=_auth_headers(token_a),
    ).json()

    response = test_client.post(
        f"/api/v1/transactions/{expense['id']}/convert-to-transfer",
        json={"other_account_id": account_b},
        headers=_auth_headers(token_a),
    )
    assert response.status_code == 404


def test_convert_to_transfer_returns_404_for_missing_transaction(test_client) -> None:
    """Converting a nonexistent transaction returns 404."""
    token, account_id, _ = _setup(test_client)
    fake_id = "00000000-0000-0000-0000-000000000000"

    response = test_client.post(
        f"/api/v1/transactions/{fake_id}/convert-to-transfer",
        json={"other_account_id": account_id},
        headers=_auth_headers(token),
    )
    assert response.status_code == 404


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



# =============================================================================
# Split transactions
# =============================================================================


def test_create_split_transaction(test_client) -> None:
    """
    Creating a transaction with splits should set is_split=True,
    category_id=None on the parent, and create TransactionSplit rows.
    """
    token, account_id, _ = _setup(test_client)
    cats = test_client.get("/api/v1/categories", headers=_auth_headers(token)).json()
    cat_a = cats[0]["id"]
    cat_b = cats[1]["id"]

    response = test_client.post(
        "/api/v1/transactions",
        json={
            "account_id": account_id,
            "date": "2026-01-15",
            "amount": "100.00",
            "transaction_type": "expense",
            "splits": [
                {"category_id": cat_a, "amount": "60.00", "note": "groceries"},
                {"category_id": cat_b, "amount": "40.00"},
            ],
        },
        headers=_auth_headers(token),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["is_split"] is True
    assert body["category_id"] is None
    assert len(body["splits"]) == 2
    amounts = sorted([s["amount"] for s in body["splits"]])
    assert amounts == ["40.00", "60.00"]


def test_split_amounts_must_equal_transaction_total(test_client) -> None:
    """Splits that don't sum to the transaction amount should return 422."""
    token, account_id, category_id = _setup(test_client)

    response = test_client.post(
        "/api/v1/transactions",
        json={
            "account_id": account_id,
            "date": "2026-01-15",
            "amount": "100.00",
            "transaction_type": "expense",
            "splits": [
                {"category_id": category_id, "amount": "50.00"},
                {"category_id": category_id, "amount": "30.00"},
            ],
        },
        headers=_auth_headers(token),
    )
    assert response.status_code == 422
    assert "split amounts" in response.json()["detail"].lower()


def test_split_transaction_actuals_appear_in_correct_categories(test_client) -> None:
    """
    A split transaction's amounts should appear in the plan view under
    each split's category, not under the parent transaction's (null) category.
    """
    token, account_id, _ = _setup(test_client)
    cats = test_client.get("/api/v1/categories", headers=_auth_headers(token)).json()
    cat_a = cats[0]["id"]
    cat_b = cats[1]["id"]

    test_client.post(
        "/api/v1/transactions",
        json={
            "account_id": account_id,
            "date": "2026-01-15",
            "amount": "100.00",
            "transaction_type": "expense",
            "status": "cleared",
            "splits": [
                {"category_id": cat_a, "amount": "60.00"},
                {"category_id": cat_b, "amount": "40.00"},
            ],
        },
        headers=_auth_headers(token),
    )

    plan = test_client.get("/api/v1/plan/2026/1", headers=_auth_headers(token))
    assert plan.status_code == 200
    rows = plan.json()["rows"]
    row_a = next((r for r in rows if r["category_id"] == cat_a), None)
    row_b = next((r for r in rows if r["category_id"] == cat_b), None)
    assert row_a is not None
    assert row_a["actual"] == "60.00"
    assert row_b is not None
    assert row_b["actual"] == "40.00"


def test_update_split_transaction(test_client) -> None:
    """Updating splits should replace existing ones."""
    token, account_id, _ = _setup(test_client)
    cats = test_client.get("/api/v1/categories", headers=_auth_headers(token)).json()
    cat_a = cats[0]["id"]
    cat_b = cats[1]["id"]

    # Create with 2 splits
    create_resp = test_client.post(
        "/api/v1/transactions",
        json={
            "account_id": account_id,
            "date": "2026-01-15",
            "amount": "100.00",
            "transaction_type": "expense",
            "splits": [
                {"category_id": cat_a, "amount": "60.00"},
                {"category_id": cat_b, "amount": "40.00"},
            ],
        },
        headers=_auth_headers(token),
    )
    tx_id = create_resp.json()["id"]

    # Update: change to single split
    update_resp = test_client.put(
        f"/api/v1/transactions/{tx_id}",
        json={
            "splits": [
                {"category_id": cat_a, "amount": "100.00"},
            ],
        },
        headers=_auth_headers(token),
    )
    assert update_resp.status_code == 200
    body = update_resp.json()
    assert body["is_split"] is True
    assert len(body["splits"]) == 1
    assert body["splits"][0]["amount"] == "100.00"


# =============================================================================
# Pagination
# =============================================================================


def test_list_transactions_pagination(test_client) -> None:
    """
    GET /api/v1/transactions returns a paginated envelope with correct
    total, page, page_size, and total_pages. Requesting page 2 returns
    the remaining items.
    """
    token, account_id, category_id = _setup(test_client)

    base = {**_TXN, "account_id": account_id, "category_id": category_id}
    for i in range(5):
        test_client.post(
            "/api/v1/transactions",
            json={**base, "payee": f"Shop {i}"},
            headers=_auth_headers(token),
        )

    # Page 1 with page_size=2
    resp1 = test_client.get(
        "/api/v1/transactions?page=1&page_size=2",
        headers=_auth_headers(token),
    )
    assert resp1.status_code == 200
    body1 = resp1.json()
    assert body1["total"] == 5
    assert body1["page"] == 1
    assert body1["page_size"] == 2
    assert body1["total_pages"] == 3
    assert len(body1["items"]) == 2

    # Page 3 should have 1 item
    resp3 = test_client.get(
        "/api/v1/transactions?page=3&page_size=2",
        headers=_auth_headers(token),
    )
    body3 = resp3.json()
    assert len(body3["items"]) == 1
    assert body3["page"] == 3


# =============================================================================
# Date filter
# =============================================================================


def test_list_transactions_date_filter(test_client) -> None:
    """
    GET /api/v1/transactions?date_from=...&date_to=... returns only
    transactions within the specified date range.
    """
    token, account_id, category_id = _setup(test_client)

    base = {"account_id": account_id, "category_id": category_id,
            "amount": "10.00", "transaction_type": "expense"}

    test_client.post(
        "/api/v1/transactions",
        json={**base, "date": "2026-01-10", "payee": "January"},
        headers=_auth_headers(token),
    )
    test_client.post(
        "/api/v1/transactions",
        json={**base, "date": "2026-03-15", "payee": "March"},
        headers=_auth_headers(token),
    )
    test_client.post(
        "/api/v1/transactions",
        json={**base, "date": "2026-06-20", "payee": "June"},
        headers=_auth_headers(token),
    )

    # Filter: Feb 1 to Apr 30 → only March
    resp = test_client.get(
        "/api/v1/transactions?date_from=2026-02-01&date_to=2026-04-30",
        headers=_auth_headers(token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["payee"] == "March"

    # date_from only → March and June
    resp2 = test_client.get(
        "/api/v1/transactions?date_from=2026-02-01",
        headers=_auth_headers(token),
    )
    assert resp2.json()["total"] == 2


# =============================================================================
# Search
# =============================================================================


def test_list_transactions_search_by_note(test_client) -> None:
    """
    GET /api/v1/transactions?search=... matches against both payee and note
    fields (case-insensitive).
    """
    token, account_id, category_id = _setup(test_client)

    base = {"account_id": account_id, "category_id": category_id,
            "amount": "10.00", "transaction_type": "expense", "date": "2026-01-15"}

    test_client.post(
        "/api/v1/transactions",
        json={**base, "payee": "Tesco", "note": "Weekly shop"},
        headers=_auth_headers(token),
    )
    test_client.post(
        "/api/v1/transactions",
        json={**base, "payee": "Amazon", "note": "Birthday gift"},
        headers=_auth_headers(token),
    )
    test_client.post(
        "/api/v1/transactions",
        json={**base, "payee": "Sainsburys", "note": None},
        headers=_auth_headers(token),
    )

    # Search by note content — only Tesco has "weekly" in its note
    resp = test_client.get(
        "/api/v1/transactions?search=weekly",
        headers=_auth_headers(token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["payee"] == "Tesco"

    # Search by payee — "zon" matches Amazon
    resp2 = test_client.get(
        "/api/v1/transactions?search=zon",
        headers=_auth_headers(token),
    )
    assert resp2.json()["total"] == 1
    assert resp2.json()["items"][0]["payee"] == "Amazon"

    # Search matches note OR payee — "gift" is in Amazon's note
    resp3 = test_client.get(
        "/api/v1/transactions?search=gift",
        headers=_auth_headers(token),
    )
    assert resp3.json()["total"] == 1
    assert resp3.json()["items"][0]["payee"] == "Amazon"


# =============================================================================
# Totals
# =============================================================================


def test_totals_single_currency_expenses_only(test_client) -> None:
    """Single currency, expenses only — net is negative expenses."""
    token, account_id, category_id = _setup(test_client)
    base = {"account_id": account_id, "category_id": category_id,
            "date": "2026-01-15", "transaction_type": "expense"}

    test_client.post("/api/v1/transactions",
                     json={**base, "amount": "100.00"}, headers=_auth_headers(token))
    test_client.post("/api/v1/transactions",
                     json={**base, "amount": "50.00"}, headers=_auth_headers(token))

    resp = test_client.get("/api/v1/transactions", headers=_auth_headers(token))
    totals = resp.json()["totals"]
    assert totals["expenses"] == [{"currency": "GBP", "amount": "150.00"}]
    assert totals["income"] == []
    assert totals["transfers"] == []
    assert totals["net"] == [{"currency": "GBP", "amount": "-150.00"}]


def test_totals_mixed_types(test_client) -> None:
    """Mixed types — all four totals correct, transfers excluded from net."""
    token, account_id, category_id = _setup(test_client)
    base = {"account_id": account_id, "category_id": category_id, "date": "2026-01-15"}

    test_client.post("/api/v1/transactions",
                     json={**base, "amount": "200.00", "transaction_type": "expense"},
                     headers=_auth_headers(token))
    test_client.post("/api/v1/transactions",
                     json={**base, "amount": "500.00", "transaction_type": "income"},
                     headers=_auth_headers(token))

    # Create a transfer (two legs)
    account_b = _create_account(test_client, token, name="Savings")
    test_client.post("/api/v1/transactions/transfer",
                     json={"from_account_id": account_id, "to_account_id": account_b,
                           "date": "2026-01-15", "amount": "50.00"},
                     headers=_auth_headers(token))

    resp = test_client.get("/api/v1/transactions", headers=_auth_headers(token))
    totals = resp.json()["totals"]
    assert totals["expenses"] == [{"currency": "GBP", "amount": "200.00"}]
    assert totals["income"] == [{"currency": "GBP", "amount": "500.00"}]
    assert totals["transfers"] == [{"currency": "GBP", "amount": "100.00"}]  # two legs
    assert totals["net"] == [{"currency": "GBP", "amount": "300.00"}]


def test_totals_multi_currency(test_client) -> None:
    """Multi-currency — multiple currency rows per total."""
    token, account_id, category_id = _setup(test_client)

    test_client.post("/api/v1/transactions",
                     json={"account_id": account_id, "category_id": category_id,
                           "date": "2026-01-15", "amount": "100.00",
                           "transaction_type": "expense", "currency": "GBP"},
                     headers=_auth_headers(token))
    test_client.post("/api/v1/transactions",
                     json={"account_id": account_id, "category_id": category_id,
                           "date": "2026-01-15", "amount": "45.00",
                           "transaction_type": "expense", "currency": "EUR"},
                     headers=_auth_headers(token))

    resp = test_client.get("/api/v1/transactions", headers=_auth_headers(token))
    totals = resp.json()["totals"]
    # Sorted by currency code
    assert totals["expenses"] == [
        {"currency": "EUR", "amount": "45.00"},
        {"currency": "GBP", "amount": "100.00"},
    ]


def test_totals_with_splits(test_client) -> None:
    """Split transaction — split amounts used, not parent amount."""
    token, account_id, _ = _setup(test_client)
    categories = test_client.get("/api/v1/categories",
                                 headers=_auth_headers(token)).json()
    cat_a = categories[0]["id"]
    cat_b = categories[1]["id"]

    test_client.post("/api/v1/transactions",
                     json={"account_id": account_id, "date": "2026-01-15",
                           "amount": "100.00", "transaction_type": "expense",
                           "splits": [
                               {"category_id": cat_a, "amount": "60.00"},
                               {"category_id": cat_b, "amount": "40.00"},
                           ]},
                     headers=_auth_headers(token))

    resp = test_client.get("/api/v1/transactions", headers=_auth_headers(token))
    totals = resp.json()["totals"]
    # Split amounts sum to 100 (60+40), same as parent — but derived from splits
    assert totals["expenses"] == [{"currency": "GBP", "amount": "100.00"}]


def test_totals_category_filter_with_splits(test_client) -> None:
    """Category filter matches split categories, not parent."""
    token, account_id, _ = _setup(test_client)
    categories = test_client.get("/api/v1/categories",
                                 headers=_auth_headers(token)).json()
    cat_a = categories[0]["id"]
    cat_b = categories[1]["id"]

    # Split transaction: 60 in cat_a, 40 in cat_b
    test_client.post("/api/v1/transactions",
                     json={"account_id": account_id, "date": "2026-01-15",
                           "amount": "100.00", "transaction_type": "expense",
                           "splits": [
                               {"category_id": cat_a, "amount": "60.00"},
                               {"category_id": cat_b, "amount": "40.00"},
                           ]},
                     headers=_auth_headers(token))

    # Filter by cat_a — the split transaction matches, totals use split amounts
    resp = test_client.get(f"/api/v1/transactions?category_id={cat_a}",
                           headers=_auth_headers(token))
    totals = resp.json()["totals"]
    # The full split transaction is included (100 total from splits)
    assert totals["expenses"] == [{"currency": "GBP", "amount": "100.00"}]


def test_totals_pagination_does_not_affect(test_client) -> None:
    """Same totals on page 1 and page 2 of same filter."""
    token, account_id, category_id = _setup(test_client)
    base = {"account_id": account_id, "category_id": category_id,
            "date": "2026-01-15", "transaction_type": "expense"}

    for i in range(3):
        test_client.post("/api/v1/transactions",
                         json={**base, "amount": "10.00"},
                         headers=_auth_headers(token))

    resp1 = test_client.get("/api/v1/transactions?page=1&page_size=2",
                            headers=_auth_headers(token))
    resp2 = test_client.get("/api/v1/transactions?page=2&page_size=2",
                            headers=_auth_headers(token))

    assert resp1.json()["totals"] == resp2.json()["totals"]
    assert resp1.json()["totals"]["expenses"] == [{"currency": "GBP", "amount": "30.00"}]


def test_totals_no_matching_transactions(test_client) -> None:
    """No transactions match filter — all totals are empty arrays."""
    token, account_id, category_id = _setup(test_client)

    resp = test_client.get("/api/v1/transactions?status=cleared",
                           headers=_auth_headers(token))
    totals = resp.json()["totals"]
    assert totals["expenses"] == []
    assert totals["income"] == []
    assert totals["transfers"] == []
    assert totals["net"] == []


def test_totals_net_zero_is_returned(test_client) -> None:
    """Net of zero is returned for currencies where income equals expenses."""
    token, account_id, category_id = _setup(test_client)

    test_client.post("/api/v1/transactions",
                     json={"account_id": account_id, "category_id": category_id,
                           "date": "2026-01-15", "amount": "100.00",
                           "transaction_type": "expense"},
                     headers=_auth_headers(token))
    test_client.post("/api/v1/transactions",
                     json={"account_id": account_id, "category_id": category_id,
                           "date": "2026-01-15", "amount": "100.00",
                           "transaction_type": "income"},
                     headers=_auth_headers(token))

    resp = test_client.get("/api/v1/transactions", headers=_auth_headers(token))
    totals = resp.json()["totals"]
    assert totals["net"] == [{"currency": "GBP", "amount": "0.00"}]


def test_totals_refunds_excluded(test_client) -> None:
    """Refund transactions are excluded from all totals buckets."""
    token, account_id, category_id = _setup(test_client)

    # Create an expense, then a refund referencing it
    expense_resp = test_client.post(
        "/api/v1/transactions",
        json={"account_id": account_id, "category_id": category_id,
              "date": "2026-01-15", "amount": "50.00",
              "transaction_type": "expense"},
        headers=_auth_headers(token),
    )
    expense_id = expense_resp.json()["id"]

    test_client.post(
        "/api/v1/transactions",
        json={"account_id": account_id, "category_id": category_id,
              "date": "2026-01-16", "amount": "50.00",
              "transaction_type": "refund",
              "parent_transaction_id": expense_id},
        headers=_auth_headers(token),
    )

    resp = test_client.get("/api/v1/transactions", headers=_auth_headers(token))
    totals = resp.json()["totals"]
    # Expense is counted, refund is NOT
    assert totals["expenses"] == [{"currency": "GBP", "amount": "50.00"}]
    assert totals["income"] == []
    assert totals["transfers"] == []
    # Net only includes expenses (no refund offset)
    assert totals["net"] == [{"currency": "GBP", "amount": "-50.00"}]
