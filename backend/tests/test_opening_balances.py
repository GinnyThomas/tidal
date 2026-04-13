# tests/test_opening_balances.py

def _register_and_login(test_client, email="user@example.com", password="securepassword"):
    test_client.post("/api/v1/auth/register", json={"email": email, "password": password})
    resp = test_client.post("/api/v1/auth/login", json={"email": email, "password": password})
    return resp.json()["access_token"]


def _auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_create_opening_balance_returns_201(test_client):
    token = _register_and_login(test_client)
    resp = test_client.post("/api/v1/opening-balances", json={
        "group": "UK", "year": 2026, "opening_balance": "5000.00",
    }, headers=_auth_headers(token))
    assert resp.status_code == 201
    body = resp.json()
    assert body["group"] == "UK"
    assert body["opening_balance"] == "5000.00"
    assert body["year"] == 2026


def test_duplicate_opening_balance_returns_409(test_client):
    token = _register_and_login(test_client)
    test_client.post("/api/v1/opening-balances", json={
        "group": "UK", "year": 2026, "opening_balance": "5000.00",
    }, headers=_auth_headers(token))
    resp = test_client.post("/api/v1/opening-balances", json={
        "group": "UK", "year": 2026, "opening_balance": "9999.00",
    }, headers=_auth_headers(token))
    assert resp.status_code == 409


def test_update_opening_balance(test_client):
    token = _register_and_login(test_client)
    create_resp = test_client.post("/api/v1/opening-balances", json={
        "group": "UK", "year": 2026, "opening_balance": "5000.00",
    }, headers=_auth_headers(token))
    ob_id = create_resp.json()["id"]

    update_resp = test_client.put(f"/api/v1/opening-balances/{ob_id}", json={
        "opening_balance": "7500.00",
    }, headers=_auth_headers(token))
    assert update_resp.status_code == 200
    assert update_resp.json()["opening_balance"] == "7500.00"


def test_annual_plan_includes_opening_balances(test_client):
    token = _register_and_login(test_client)
    test_client.post("/api/v1/opening-balances", json={
        "group": "UK", "year": 2026, "opening_balance": "3000.00",
    }, headers=_auth_headers(token))

    resp = test_client.get("/api/v1/plan/2026", headers=_auth_headers(token))
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["opening_balances"]) == 1
    assert body["opening_balances"][0]["group"] == "UK"
    assert body["opening_balances"][0]["opening_balance"] == "3000.00"
