# tests/test_promotions.py
#
# Purpose: Tests for the Promotions endpoints and computed fields.

from datetime import date, timedelta


def _register_and_login(test_client, email="user@example.com", password="securepassword"):
    test_client.post("/api/v1/auth/register", json={"email": email, "password": password})
    resp = test_client.post("/api/v1/auth/login", json={"email": email, "password": password})
    return resp.json()["access_token"]


def _auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def _create_account(test_client, token):
    resp = test_client.post("/api/v1/accounts", json={"name": "Test", "account_type": "checking"}, headers=_auth_headers(token))
    return resp.json()["id"]


def _get_category_id(test_client, token):
    cats = test_client.get("/api/v1/categories", headers=_auth_headers(token)).json()
    return cats[0]["id"]


def _setup(test_client):
    token = _register_and_login(test_client)
    account_id = _create_account(test_client, token)
    category_id = _get_category_id(test_client, token)
    return token, account_id, category_id


def _create_promotion(test_client, token, **kwargs):
    defaults = {
        "name": "Test Promo",
        "promotion_type": "balance_transfer",
        "original_balance": "2000.00",
        "start_date": str(date.today() - timedelta(days=30)),
        "end_date": str(date.today() + timedelta(days=90)),
    }
    resp = test_client.post("/api/v1/promotions", json={**defaults, **kwargs}, headers=_auth_headers(token))
    assert resp.status_code == 201, f"Promotion create failed: {resp.json()}"
    return resp.json()


# =============================================================================
# CRUD
# =============================================================================


def test_create_promotion_returns_201(test_client):
    token, _, _ = _setup(test_client)
    promo = _create_promotion(test_client, token)

    assert promo["name"] == "Test Promo"
    assert promo["promotion_type"] == "balance_transfer"
    assert promo["original_balance"] == "2000.00"
    assert "id" in promo
    assert "days_remaining" in promo
    assert "urgency" in promo
    assert promo["total_paid"] == "0.00"
    assert promo["remaining_balance"] == "2000.00"


def test_list_promotions_active_only(test_client):
    token, _, _ = _setup(test_client)
    _create_promotion(test_client, token, name="Active", is_active=True)
    _create_promotion(test_client, token, name="Inactive", is_active=False)

    resp = test_client.get("/api/v1/promotions?active_only=true", headers=_auth_headers(token))
    assert resp.status_code == 200
    names = {p["name"] for p in resp.json()}
    assert "Active" in names
    assert "Inactive" not in names


def test_delete_promotion(test_client):
    token, _, _ = _setup(test_client)
    promo = _create_promotion(test_client, token)

    resp = test_client.delete(f"/api/v1/promotions/{promo['id']}", headers=_auth_headers(token))
    assert resp.status_code == 204

    resp = test_client.get(f"/api/v1/promotions/{promo['id']}", headers=_auth_headers(token))
    assert resp.status_code == 404


# =============================================================================
# Urgency
# =============================================================================


def test_promotion_urgency_critical(test_client):
    token, _, _ = _setup(test_client)
    promo = _create_promotion(
        test_client, token,
        end_date=str(date.today() + timedelta(days=3)),
    )
    assert promo["urgency"] == "critical"
    assert promo["days_remaining"] == 3


def test_promotion_urgency_warning(test_client):
    token, _, _ = _setup(test_client)
    promo = _create_promotion(
        test_client, token,
        end_date=str(date.today() + timedelta(days=20)),
    )
    assert promo["urgency"] == "warning"


def test_promotion_urgency_ok(test_client):
    token, _, _ = _setup(test_client)
    promo = _create_promotion(
        test_client, token,
        end_date=str(date.today() + timedelta(days=90)),
    )
    assert promo["urgency"] == "ok"


# =============================================================================
# Computed financial fields
# =============================================================================


def test_promotion_total_paid_sums_linked_transactions(test_client):
    token, account_id, category_id = _setup(test_client)
    promo = _create_promotion(test_client, token)

    # Create two transactions linked to the promotion
    for amount in ["100.00", "200.00"]:
        test_client.post(
            "/api/v1/transactions",
            json={
                "account_id": account_id,
                "category_id": category_id,
                "date": str(date.today()),
                "amount": amount,
                "transaction_type": "expense",
                "status": "cleared",
                "promotion_id": promo["id"],
            },
            headers=_auth_headers(token),
        )

    resp = test_client.get(f"/api/v1/promotions/{promo['id']}", headers=_auth_headers(token))
    assert resp.json()["total_paid"] == "300.00"


def test_promotion_remaining_balance(test_client):
    token, account_id, category_id = _setup(test_client)
    promo = _create_promotion(test_client, token, original_balance="1000.00")

    test_client.post(
        "/api/v1/transactions",
        json={
            "account_id": account_id,
            "category_id": category_id,
            "date": str(date.today()),
            "amount": "400.00",
            "transaction_type": "expense",
            "status": "cleared",
            "promotion_id": promo["id"],
        },
        headers=_auth_headers(token),
    )

    resp = test_client.get(f"/api/v1/promotions/{promo['id']}", headers=_auth_headers(token))
    assert resp.json()["remaining_balance"] == "600.00"
