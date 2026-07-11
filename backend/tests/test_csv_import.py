# tests/test_csv_import.py
#
# Tests for:
#   POST /api/v1/transactions/import
#   GET  /api/v1/csv-mappings/{account_id}
#   POST /api/v1/csv-mappings

from decimal import Decimal


# =============================================================================
# Helpers (same pattern as test_transactions.py)
# =============================================================================


def _register_and_login(
    test_client,
    email: str = "user@example.com",
    password: str = "securepassword",
) -> str:
    test_client.post("/api/v1/auth/register", json={"email": email, "password": password})
    response = test_client.post("/api/v1/auth/login", json={"email": email, "password": password})
    return response.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _create_account(test_client, token: str, name: str = "Test Account", currency: str = "GBP") -> str:
    response = test_client.post(
        "/api/v1/accounts",
        json={"name": name, "account_type": "checking", "currency": currency},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _setup(test_client):
    token = _register_and_login(test_client)
    account_id = _create_account(test_client, token)
    return token, account_id


_ROW = {
    "date": "2026-01-15",
    "amount": "-42.50",
    "payee": "Tesco",
}


# =============================================================================
# Import endpoint — basic creation
# =============================================================================


def test_import_creates_transactions(test_client) -> None:
    """
    POST /api/v1/transactions/import with valid rows creates transactions
    and returns the correct counts.
    """
    token, account_id = _setup(test_client)

    response = test_client.post(
        "/api/v1/transactions/import",
        json={
            "account_id": account_id,
            "transactions": [
                {"date": "2026-01-15", "amount": "-42.50", "payee": "Tesco"},
                {"date": "2026-01-16", "amount": "-10.00", "payee": "Starbucks"},
                {"date": "2026-01-17", "amount": "1200.00", "payee": "Employer"},
            ],
        },
        headers=_auth(token),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["created"] == 3
    assert body["skipped_duplicates"] == 0


def test_import_sets_currency_from_account(test_client) -> None:
    """
    Imported transactions use the account's currency, regardless of what
    the request says.
    """
    token = _register_and_login(test_client)
    account_id = _create_account(test_client, token, currency="EUR")

    test_client.post(
        "/api/v1/transactions/import",
        json={
            "account_id": account_id,
            "transactions": [{"date": "2026-01-15", "amount": "-10.00", "payee": "Shop"}],
        },
        headers=_auth(token),
    )

    txns = test_client.get(
        f"/api/v1/transactions?account_id={account_id}",
        headers=_auth(token),
    ).json()
    assert txns["items"][0]["currency"] == "EUR"


def test_import_sets_status_cleared(test_client) -> None:
    """All imported transactions have status=cleared."""
    token, account_id = _setup(test_client)

    test_client.post(
        "/api/v1/transactions/import",
        json={
            "account_id": account_id,
            "transactions": [{"date": "2026-01-15", "amount": "-10.00", "payee": "Shop"}],
        },
        headers=_auth(token),
    )

    txns = test_client.get(
        f"/api/v1/transactions?account_id={account_id}",
        headers=_auth(token),
    ).json()
    assert txns["items"][0]["status"] == "cleared"


def test_import_sets_category_null(test_client) -> None:
    """All imported transactions have category_id=None."""
    token, account_id = _setup(test_client)

    test_client.post(
        "/api/v1/transactions/import",
        json={
            "account_id": account_id,
            "transactions": [{"date": "2026-01-15", "amount": "-10.00", "payee": "Shop"}],
        },
        headers=_auth(token),
    )

    txns = test_client.get(
        f"/api/v1/transactions?account_id={account_id}",
        headers=_auth(token),
    ).json()
    assert txns["items"][0]["category_id"] is None


def test_import_stores_notes(test_client) -> None:
    """Notes field is stored as note on the transaction."""
    token, account_id = _setup(test_client)

    test_client.post(
        "/api/v1/transactions/import",
        json={
            "account_id": account_id,
            "transactions": [
                {"date": "2026-01-15", "amount": "-10.00", "payee": "Shop", "notes": "birthday gift"}
            ],
        },
        headers=_auth(token),
    )

    txns = test_client.get(
        f"/api/v1/transactions?account_id={account_id}",
        headers=_auth(token),
    ).json()
    assert txns["items"][0]["note"] == "birthday gift"


# =============================================================================
# Import — dedup by hash
# =============================================================================


def test_import_skips_hash_duplicates(test_client) -> None:
    """
    Importing the same row twice: second import skips it by hash match.
    """
    token, account_id = _setup(test_client)

    payload = {
        "account_id": account_id,
        "transactions": [{"date": "2026-01-15", "amount": "-42.50", "payee": "Tesco"}],
    }

    r1 = test_client.post("/api/v1/transactions/import", json=payload, headers=_auth(token))
    assert r1.json()["created"] == 1
    assert r1.json()["skipped_duplicates"] == 0

    r2 = test_client.post("/api/v1/transactions/import", json=payload, headers=_auth(token))
    assert r2.json()["created"] == 0
    assert r2.json()["skipped_duplicates"] == 1


def test_import_dedup_round_trip_manual_then_import(test_client) -> None:
    """
    Hash is computed identically for manual create and import.
    Create manually first, then import same data → import skips it.
    """
    token, account_id = _setup(test_client)

    # Get a category for the manual create
    cats = test_client.get("/api/v1/categories", headers=_auth(token)).json()
    category_id = cats[0]["id"]

    # Create manually
    test_client.post(
        "/api/v1/transactions",
        json={
            "account_id": account_id,
            "category_id": category_id,
            "date": "2026-03-10",
            "amount": "99.99",
            "transaction_type": "expense",
            "payee": "Amazon UK",
            "status": "cleared",
        },
        headers=_auth(token),
    )

    # Import the same data — should be skipped as a duplicate
    r = test_client.post(
        "/api/v1/transactions/import",
        json={
            "account_id": account_id,
            "transactions": [
                {"date": "2026-03-10", "amount": "99.99", "payee": "Amazon UK"},
            ],
        },
        headers=_auth(token),
    )
    assert r.status_code == 201
    assert r.json()["created"] == 0
    assert r.json()["skipped_duplicates"] == 1


# =============================================================================
# Import — dedup by external_id
# =============================================================================


def test_import_skips_external_id_duplicates(test_client) -> None:
    """
    A row with an external_id that already exists is skipped even if the
    other fields differ (e.g. bank updated description).
    """
    token, account_id = _setup(test_client)

    first = {
        "account_id": account_id,
        "transactions": [
            {"date": "2026-01-15", "amount": "-42.50", "payee": "Tesco", "external_id": "TX001"},
        ],
    }
    r1 = test_client.post("/api/v1/transactions/import", json=first, headers=_auth(token))
    assert r1.json()["created"] == 1

    # Same external_id, different payee name — still a duplicate
    second = {
        "account_id": account_id,
        "transactions": [
            {"date": "2026-01-15", "amount": "-42.50", "payee": "TESCO STORES", "external_id": "TX001"},
        ],
    }
    r2 = test_client.post("/api/v1/transactions/import", json=second, headers=_auth(token))
    assert r2.json()["created"] == 0
    assert r2.json()["skipped_duplicates"] == 1


def test_import_dedup_within_same_batch(test_client) -> None:
    """
    If the same row appears twice in one import batch, only the first is created.
    """
    token, account_id = _setup(test_client)

    r = test_client.post(
        "/api/v1/transactions/import",
        json={
            "account_id": account_id,
            "transactions": [
                {"date": "2026-01-15", "amount": "-10.00", "payee": "Shop", "external_id": "EXT1"},
                {"date": "2026-01-15", "amount": "-10.00", "payee": "Shop", "external_id": "EXT1"},
            ],
        },
        headers=_auth(token),
    )
    assert r.status_code == 201
    assert r.json()["created"] == 1
    assert r.json()["skipped_duplicates"] == 1


# =============================================================================
# Import — auth and validation
# =============================================================================


def test_import_requires_auth(test_client) -> None:
    """Import endpoint requires a valid JWT."""
    response = test_client.post(
        "/api/v1/transactions/import",
        json={"account_id": "00000000-0000-0000-0000-000000000001", "transactions": []},
    )
    assert response.status_code == 401


def test_import_returns_404_for_unknown_account(test_client) -> None:
    """Import with an unknown account_id returns 404."""
    token = _register_and_login(test_client)
    response = test_client.post(
        "/api/v1/transactions/import",
        json={
            "account_id": "00000000-0000-0000-0000-000000000099",
            "transactions": [{"date": "2026-01-15", "amount": "-10.00", "payee": "Shop"}],
        },
        headers=_auth(token),
    )
    assert response.status_code == 404


def test_import_empty_list_succeeds(test_client) -> None:
    """Importing an empty list is a no-op (0 created, 0 skipped)."""
    token, account_id = _setup(test_client)
    r = test_client.post(
        "/api/v1/transactions/import",
        json={"account_id": account_id, "transactions": []},
        headers=_auth(token),
    )
    assert r.status_code == 201
    assert r.json()["created"] == 0
    assert r.json()["skipped_duplicates"] == 0


# =============================================================================
# CSV mappings
# =============================================================================


def test_csv_mapping_get_returns_404_when_none_saved(test_client) -> None:
    """GET /api/v1/csv-mappings/{account_id} returns 404 if no mapping saved."""
    token, account_id = _setup(test_client)
    r = test_client.get(f"/api/v1/csv-mappings/{account_id}", headers=_auth(token))
    assert r.status_code == 404


def test_csv_mapping_create_and_retrieve(test_client) -> None:
    """POST creates a mapping; GET returns it."""
    token, account_id = _setup(test_client)

    mapping_json = {
        "date_column": "Date",
        "amount_column": "Amount",
        "payee_column": "Merchant",
        "date_format": "YYYY-MM-DD",
        "decimal_separator": ".",
    }

    r = test_client.post(
        "/api/v1/csv-mappings",
        json={"account_id": account_id, "name": "My Bank", "mapping_json": mapping_json},
        headers=_auth(token),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "My Bank"
    assert body["mapping_json"] == mapping_json
    assert body["account_id"] == account_id

    get_r = test_client.get(f"/api/v1/csv-mappings/{account_id}", headers=_auth(token))
    assert get_r.status_code == 200
    assert get_r.json()["mapping_json"] == mapping_json


def test_csv_mapping_upsert_updates_existing(test_client) -> None:
    """POSTing a second time for the same account updates the existing mapping."""
    token, account_id = _setup(test_client)

    test_client.post(
        "/api/v1/csv-mappings",
        json={"account_id": account_id, "name": "Old Name", "mapping_json": {"col": "A"}},
        headers=_auth(token),
    )

    r = test_client.post(
        "/api/v1/csv-mappings",
        json={"account_id": account_id, "name": "New Name", "mapping_json": {"col": "B"}},
        headers=_auth(token),
    )
    assert r.status_code == 200
    assert r.json()["name"] == "New Name"
    assert r.json()["mapping_json"] == {"col": "B"}

    # Only one mapping exists
    get_r = test_client.get(f"/api/v1/csv-mappings/{account_id}", headers=_auth(token))
    assert get_r.json()["mapping_json"]["col"] == "B"


def test_csv_mapping_scoped_to_user(test_client) -> None:
    """User B cannot see User A's mapping."""
    token_a = _register_and_login(test_client, "a@example.com")
    account_a = _create_account(test_client, token_a)

    token_b = _register_and_login(test_client, "b@example.com")

    # A saves a mapping for their account
    test_client.post(
        "/api/v1/csv-mappings",
        json={"account_id": account_a, "name": "A's mapping", "mapping_json": {}},
        headers=_auth(token_a),
    )

    # B tries to GET A's account — should 404 (account doesn't belong to B)
    r = test_client.get(f"/api/v1/csv-mappings/{account_a}", headers=_auth(token_b))
    assert r.status_code == 404


def test_csv_mapping_requires_auth(test_client) -> None:
    """Both CSV mapping endpoints require a valid JWT."""
    r_get = test_client.get("/api/v1/csv-mappings/00000000-0000-0000-0000-000000000001")
    assert r_get.status_code == 401

    r_post = test_client.post(
        "/api/v1/csv-mappings",
        json={"account_id": "00000000-0000-0000-0000-000000000001", "name": "x", "mapping_json": {}},
    )
    assert r_post.status_code == 401


# =============================================================================
# Additional tests: gaps identified in code review
# =============================================================================


def test_import_stores_dedup_hash(test_client) -> None:
    """
    The dedup_hash column is actually populated on imported transactions.
    Without this test, a refactor could silently stop storing the hash.
    """
    token, account_id = _setup(test_client)

    test_client.post(
        "/api/v1/transactions/import",
        json={
            "account_id": account_id,
            "transactions": [{"date": "2026-01-15", "amount": "-42.50", "payee": "Tesco"}],
        },
        headers=_auth(token),
    )

    txns = test_client.get(
        f"/api/v1/transactions?account_id={account_id}",
        headers=_auth(token),
    ).json()
    assert txns["items"][0]["dedup_hash"] is not None
    assert len(txns["items"][0]["dedup_hash"]) == 64


def test_import_dedup_within_batch_by_hash(test_client) -> None:
    """
    Two rows with no external_id but identical date/amount/payee in the same
    batch: only the first is created; the second is deduplicated by hash.
    (Companion to test_import_dedup_within_same_batch which tests external_id.)
    """
    token, account_id = _setup(test_client)

    r = test_client.post(
        "/api/v1/transactions/import",
        json={
            "account_id": account_id,
            "transactions": [
                {"date": "2026-01-15", "amount": "-10.00", "payee": "Shop"},
                {"date": "2026-01-15", "amount": "-10.00", "payee": "Shop"},
            ],
        },
        headers=_auth(token),
    )
    assert r.status_code == 201
    assert r.json()["created"] == 1
    assert r.json()["skipped_duplicates"] == 1


def test_import_zero_amount_row(test_client) -> None:
    """
    A row with amount=0 is created as transaction_type='expense'.
    Zero-amount rows should not be classified as income.
    """
    token, account_id = _setup(test_client)

    test_client.post(
        "/api/v1/transactions/import",
        json={
            "account_id": account_id,
            "transactions": [{"date": "2026-01-15", "amount": "0.00", "payee": "Fee waiver"}],
        },
        headers=_auth(token),
    )

    txns = test_client.get(
        f"/api/v1/transactions?account_id={account_id}",
        headers=_auth(token),
    ).json()
    assert txns["items"][0]["transaction_type"] == "expense"


def test_import_rejects_other_users_account(test_client) -> None:
    """
    User B cannot import transactions into User A's account.
    The endpoint must return 404 (not 403) so account existence is not leaked.
    """
    token_a = _register_and_login(test_client, "a@example.com")
    account_a = _create_account(test_client, token_a)

    token_b = _register_and_login(test_client, "b@example.com")

    r = test_client.post(
        "/api/v1/transactions/import",
        json={
            "account_id": account_a,
            "transactions": [{"date": "2026-01-15", "amount": "-10.00", "payee": "Shop"}],
        },
        headers=_auth(token_b),
    )
    assert r.status_code == 404


def test_csv_mapping_post_rejects_other_users_account(test_client) -> None:
    """
    User B cannot save a CSV mapping against User A's account.
    """
    token_a = _register_and_login(test_client, "a2@example.com")
    account_a = _create_account(test_client, token_a)

    token_b = _register_and_login(test_client, "b2@example.com")

    r = test_client.post(
        "/api/v1/csv-mappings",
        json={"account_id": account_a, "name": "Stolen", "mapping_json": {}},
        headers=_auth(token_b),
    )
    assert r.status_code == 404


def test_import_rejects_too_many_rows(test_client) -> None:
    """Import endpoint rejects batches exceeding MAX_IMPORT_ROWS."""
    token, account_id = _setup(test_client)
    rows = [{"date": "2026-01-15", "amount": "-1.00", "payee": "Shop"}] * 5001

    r = test_client.post(
        "/api/v1/transactions/import",
        json={"account_id": account_id, "transactions": rows},
        headers=_auth(token),
    )
    assert r.status_code == 422
