# tests/test_bank_feeds.py
#
# Tests for /api/v1/bank-feeds — connecting a bank, linking its accounts to
# Tidal accounts, and syncing transactions.
#
# The real provider (Enable Banking) is swapped for FakeProvider via
# FastAPI's dependency_overrides, the same way conftest swaps get_db.
# The client itself is tested in test_enable_banking.py.

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.config import settings
from app.main import app
from app.services.bank_feeds import get_bank_feed_provider
from app.services.bank_feeds.provider import (
    AuthStart,
    BankFeedError,
    FeedTransaction,
    Institution,
    LinkedSession,
    ProviderAccount,
)


# =============================================================================
# Fake provider
# =============================================================================


class FakeProvider:
    name = "fake"

    def __init__(self) -> None:
        self.institutions = [Institution(name="Monzo", country="GB", logo=None, max_consent_days=90)]
        self.auth_calls: list[dict] = []
        self.session_valid_until = datetime.now(timezone.utc) + timedelta(days=90)
        self.accounts = [ProviderAccount(
            uid="uid-1", identification_hash="hash-1", name="Current Account",
            currency="GBP", iban_last4="5555",
        )]
        self.transactions: list[FeedTransaction] = []
        self.fetch_calls: list[tuple[str, date]] = []
        self.error: BankFeedError | None = None

    def list_institutions(self, country: str) -> list[Institution]:
        if self.error:
            raise self.error
        return [i for i in self.institutions if i.country == country]

    def start_auth(self, institution, country, redirect_url, state, valid_until) -> AuthStart:
        self.auth_calls.append({
            "institution": institution, "country": country,
            "redirect_url": redirect_url, "state": state, "valid_until": valid_until,
        })
        return AuthStart(url=f"https://bank.example/consent?state={state}")

    def create_session(self, code: str) -> LinkedSession:
        if self.error:
            raise self.error
        return LinkedSession(session_id=f"sess-{code}", valid_until=self.session_valid_until, accounts=self.accounts)

    def fetch_transactions(self, account_uid: str, date_from: date) -> list[FeedTransaction]:
        self.fetch_calls.append((account_uid, date_from))
        if self.error:
            raise self.error
        return self.transactions


@pytest.fixture
def provider(test_client) -> FakeProvider:
    fake = FakeProvider()
    app.dependency_overrides[get_bank_feed_provider] = lambda: fake
    return fake


# =============================================================================
# Helpers
# =============================================================================


def _register_and_login(test_client, email: str = "user@example.com") -> str:
    test_client.post("/api/v1/auth/register", json={"email": email, "password": "securepassword"})
    response = test_client.post("/api/v1/auth/login", json={"email": email, "password": "securepassword"})
    return response.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _create_account(test_client, token: str, currency: str = "GBP") -> str:
    response = test_client.post(
        "/api/v1/accounts",
        json={"name": "Monzo Current", "account_type": "checking", "currency": currency},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _start(test_client, token: str) -> dict:
    response = test_client.post(
        "/api/v1/bank-feeds/connections",
        json={"institution": "Monzo", "country": "GB"},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return response.json()


def _connect(test_client, token: str, provider: FakeProvider) -> dict:
    """Start + complete a connection; returns the completed connection."""
    _start(test_client, token)
    state = provider.auth_calls[-1]["state"]
    response = test_client.post(
        "/api/v1/bank-feeds/connections/complete",
        json={"code": "code-1", "state": state},
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text
    return response.json()


def _connect_and_link(test_client, token: str, provider: FakeProvider) -> tuple[str, str]:
    """Connect, link the first bank account to a new Tidal account; returns (link_id, account_id)."""
    connection = _connect(test_client, token, provider)
    link_id = connection["accounts"][0]["id"]
    account_id = _create_account(test_client, token)
    response = test_client.put(
        f"/api/v1/bank-feeds/links/{link_id}",
        json={"account_id": account_id},
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text
    return link_id, account_id


def _sync(test_client, token: str, link_id: str):
    return test_client.post(f"/api/v1/bank-feeds/links/{link_id}/sync", headers=_auth(token))


def _feed_tx(external_id: str = "e1", amount: str = "-12.34", payee: str = "Tesco") -> FeedTransaction:
    return FeedTransaction(
        date=date(2026, 9, 5), amount=Decimal(amount), payee=payee, notes=None, external_id=external_id,
    )


# =============================================================================
# Configuration and auth
# =============================================================================


def test_endpoints_require_authentication(test_client, provider) -> None:
    response = test_client.get("/api/v1/bank-feeds/institutions?country=GB")
    assert response.status_code in (401, 403)


def test_returns_503_when_bank_feeds_not_configured(test_client, monkeypatch) -> None:
    # No override and no Enable Banking credentials → feature switched off.
    monkeypatch.setattr(settings, "ENABLE_BANKING_APPLICATION_ID", "")
    monkeypatch.setattr(settings, "ENABLE_BANKING_PRIVATE_KEY", "")
    token = _register_and_login(test_client)

    response = test_client.get("/api/v1/bank-feeds/institutions?country=GB", headers=_auth(token))

    assert response.status_code == 503


# =============================================================================
# Institutions
# =============================================================================


def test_list_institutions_for_country(test_client, provider) -> None:
    token = _register_and_login(test_client)

    response = test_client.get("/api/v1/bank-feeds/institutions?country=GB", headers=_auth(token))

    assert response.status_code == 200
    assert response.json() == [{"name": "Monzo", "country": "GB", "logo": None, "max_consent_days": 90}]


def test_list_institutions_provider_error_returns_502(test_client, provider) -> None:
    provider.error = BankFeedError("down", status_code=500)
    token = _register_and_login(test_client)

    response = test_client.get("/api/v1/bank-feeds/institutions?country=GB", headers=_auth(token))

    assert response.status_code == 502


# =============================================================================
# Starting a connection
# =============================================================================


def test_start_connection_returns_bank_consent_url(test_client, provider) -> None:
    token = _register_and_login(test_client)

    body = _start(test_client, token)

    call = provider.auth_calls[0]
    assert body["auth_url"] == f"https://bank.example/consent?state={call['state']}"
    assert call["institution"] == "Monzo"
    assert call["country"] == "GB"
    assert call["redirect_url"] == f"{settings.frontend_base_url}/bank-feeds/callback"


def test_start_connection_uses_unguessable_state_per_attempt(test_client, provider) -> None:
    token = _register_and_login(test_client)

    _start(test_client, token)
    _start(test_client, token)

    first, second = (c["state"] for c in provider.auth_calls)
    assert first != second
    assert len(first) >= 32


def test_start_connection_caps_consent_at_bank_maximum(test_client, provider) -> None:
    token = _register_and_login(test_client)

    _start(test_client, token)

    valid_until = provider.auth_calls[0]["valid_until"]
    days = (valid_until - datetime.now(timezone.utc)).days
    assert 88 <= days <= 90


def test_start_connection_unknown_institution_returns_404(test_client, provider) -> None:
    token = _register_and_login(test_client)

    response = test_client.post(
        "/api/v1/bank-feeds/connections",
        json={"institution": "Not A Bank", "country": "GB"},
        headers=_auth(token),
    )

    assert response.status_code == 404


# =============================================================================
# Completing a connection (bank redirect callback)
# =============================================================================


def test_complete_connection_activates_it_and_lists_accounts(test_client, provider) -> None:
    token = _register_and_login(test_client)

    connection = _connect(test_client, token, provider)

    assert connection["status"] == "active"
    assert connection["institution_name"] == "Monzo"
    assert len(connection["accounts"]) == 1
    account = connection["accounts"][0]
    assert account["name"] == "Current Account"
    assert account["currency"] == "GBP"
    assert account["iban_last4"] == "5555"
    assert account["account_id"] is None
    assert account["last_synced_at"] is None


def test_complete_connection_with_unknown_state_returns_404(test_client, provider) -> None:
    token = _register_and_login(test_client)
    _start(test_client, token)

    response = test_client.post(
        "/api/v1/bank-feeds/connections/complete",
        json={"code": "code-1", "state": "forged-state"},
        headers=_auth(token),
    )

    assert response.status_code == 404


def test_complete_connection_with_another_users_state_returns_404(test_client, provider) -> None:
    owner = _register_and_login(test_client, "owner@example.com")
    _start(test_client, owner)
    state = provider.auth_calls[0]["state"]
    attacker = _register_and_login(test_client, "attacker@example.com")

    response = test_client.post(
        "/api/v1/bank-feeds/connections/complete",
        json={"code": "code-1", "state": state},
        headers=_auth(attacker),
    )

    assert response.status_code == 404


def test_state_cannot_be_reused(test_client, provider) -> None:
    token = _register_and_login(test_client)
    _connect(test_client, token, provider)
    state = provider.auth_calls[0]["state"]

    response = test_client.post(
        "/api/v1/bank-feeds/connections/complete",
        json={"code": "code-2", "state": state},
        headers=_auth(token),
    )

    assert response.status_code == 404


def test_complete_connection_provider_error_returns_502(test_client, provider) -> None:
    token = _register_and_login(test_client)
    _start(test_client, token)
    provider.error = BankFeedError("bad code", status_code=400)

    response = test_client.post(
        "/api/v1/bank-feeds/connections/complete",
        json={"code": "code-1", "state": provider.auth_calls[0]["state"]},
        headers=_auth(token),
    )

    assert response.status_code == 502


# =============================================================================
# Listing and deleting connections
# =============================================================================


def test_list_connections_shows_only_own_active_connections(test_client, provider) -> None:
    owner = _register_and_login(test_client, "owner@example.com")
    _connect(test_client, owner, provider)
    _start(test_client, owner)  # abandoned — never completed
    other = _register_and_login(test_client, "other@example.com")

    own = test_client.get("/api/v1/bank-feeds/connections", headers=_auth(owner)).json()
    others = test_client.get("/api/v1/bank-feeds/connections", headers=_auth(other)).json()

    assert len(own) == 1
    assert own[0]["status"] == "active"
    assert others == []


def test_connection_past_valid_until_is_reported_expired(test_client, provider) -> None:
    provider.session_valid_until = datetime.now(timezone.utc) - timedelta(days=1)
    token = _register_and_login(test_client)
    _connect(test_client, token, provider)

    [connection] = test_client.get("/api/v1/bank-feeds/connections", headers=_auth(token)).json()

    assert connection["status"] == "expired"


def test_delete_connection_removes_it(test_client, provider) -> None:
    token = _register_and_login(test_client)
    connection = _connect(test_client, token, provider)

    response = test_client.delete(f"/api/v1/bank-feeds/connections/{connection['id']}", headers=_auth(token))

    assert response.status_code == 204
    assert test_client.get("/api/v1/bank-feeds/connections", headers=_auth(token)).json() == []


def test_delete_another_users_connection_returns_404(test_client, provider) -> None:
    owner = _register_and_login(test_client, "owner@example.com")
    connection = _connect(test_client, owner, provider)
    other = _register_and_login(test_client, "other@example.com")

    response = test_client.delete(f"/api/v1/bank-feeds/connections/{connection['id']}", headers=_auth(other))

    assert response.status_code == 404


# =============================================================================
# Linking bank accounts to Tidal accounts
# =============================================================================


def test_link_bank_account_to_tidal_account(test_client, provider) -> None:
    token = _register_and_login(test_client)
    link_id, account_id = _connect_and_link(test_client, token, provider)

    [connection] = test_client.get("/api/v1/bank-feeds/connections", headers=_auth(token)).json()

    assert connection["accounts"][0]["id"] == link_id
    assert connection["accounts"][0]["account_id"] == account_id


def test_unlink_bank_account(test_client, provider) -> None:
    token = _register_and_login(test_client)
    link_id, _ = _connect_and_link(test_client, token, provider)

    response = test_client.put(f"/api/v1/bank-feeds/links/{link_id}", json={"account_id": None}, headers=_auth(token))

    assert response.status_code == 200
    assert response.json()["account_id"] is None


def test_link_to_another_users_account_returns_404(test_client, provider) -> None:
    other = _register_and_login(test_client, "other@example.com")
    others_account = _create_account(test_client, other)
    token = _register_and_login(test_client)
    link_id = _connect(test_client, token, provider)["accounts"][0]["id"]

    response = test_client.put(
        f"/api/v1/bank-feeds/links/{link_id}", json={"account_id": others_account}, headers=_auth(token),
    )

    assert response.status_code == 404


def test_link_with_currency_mismatch_returns_422(test_client, provider) -> None:
    # Bank account is GBP; importing into a EUR account would mislabel every amount.
    token = _register_and_login(test_client)
    link_id = _connect(test_client, token, provider)["accounts"][0]["id"]
    eur_account = _create_account(test_client, token, currency="EUR")

    response = test_client.put(
        f"/api/v1/bank-feeds/links/{link_id}", json={"account_id": eur_account}, headers=_auth(token),
    )

    assert response.status_code == 422


def test_cannot_change_another_users_link(test_client, provider) -> None:
    owner = _register_and_login(test_client, "owner@example.com")
    link_id = _connect(test_client, owner, provider)["accounts"][0]["id"]
    other = _register_and_login(test_client, "other@example.com")

    response = test_client.put(f"/api/v1/bank-feeds/links/{link_id}", json={"account_id": None}, headers=_auth(other))

    assert response.status_code == 404


# =============================================================================
# Syncing
# =============================================================================


def test_sync_imports_feed_transactions_into_linked_account(test_client, provider) -> None:
    token = _register_and_login(test_client)
    link_id, account_id = _connect_and_link(test_client, token, provider)
    provider.transactions = [
        _feed_tx("e1", "-12.34", "Tesco"),
        _feed_tx("e2", "2500.00", "Employer Ltd"),
    ]

    response = _sync(test_client, token, link_id)

    assert response.status_code == 200, response.text
    assert response.json()["created"] == 2
    txs = test_client.get(f"/api/v1/transactions?account_id={account_id}", headers=_auth(token)).json()["items"]
    by_payee = {t["payee"]: t for t in txs}
    assert by_payee["Tesco"]["transaction_type"] == "expense"
    assert Decimal(by_payee["Tesco"]["amount"]) == Decimal("12.34")
    assert by_payee["Employer Ltd"]["transaction_type"] == "income"
    assert by_payee["Tesco"]["status"] == "cleared"


def test_second_sync_skips_already_imported_transactions(test_client, provider) -> None:
    token = _register_and_login(test_client)
    link_id, _ = _connect_and_link(test_client, token, provider)
    provider.transactions = [_feed_tx("e1")]
    _sync(test_client, token, link_id)

    response = _sync(test_client, token, link_id)

    assert response.json()["created"] == 0
    assert response.json()["skipped_duplicates"] == 1


def test_sync_skips_transaction_already_imported_from_csv(test_client, provider) -> None:
    # A CSV import without bank ids, then the feed: the dedup hash catches it.
    token = _register_and_login(test_client)
    link_id, account_id = _connect_and_link(test_client, token, provider)
    test_client.post(
        "/api/v1/transactions/import",
        json={"account_id": account_id, "transactions": [{"date": "2026-09-05", "amount": "-12.34", "payee": "Tesco"}]},
        headers=_auth(token),
    )
    provider.transactions = [_feed_tx("e1", "-12.34", "Tesco")]

    response = _sync(test_client, token, link_id)

    assert response.json()["created"] == 0


def test_first_sync_fetches_last_90_days(test_client, provider) -> None:
    token = _register_and_login(test_client)
    link_id, _ = _connect_and_link(test_client, token, provider)

    _sync(test_client, token, link_id)

    uid, date_from = provider.fetch_calls[0]
    assert uid == "uid-1"
    assert date_from == date.today() - timedelta(days=90)


def test_later_sync_overlaps_previous_by_a_week(test_client, provider) -> None:
    # Banks can book a transaction days after it happened; the overlap
    # catches those, and dedup throws away the ones we already have.
    token = _register_and_login(test_client)
    link_id, _ = _connect_and_link(test_client, token, provider)
    _sync(test_client, token, link_id)

    _sync(test_client, token, link_id)

    _, date_from = provider.fetch_calls[1]
    assert date_from == date.today() - timedelta(days=7)


def test_sync_records_last_synced_at(test_client, provider) -> None:
    token = _register_and_login(test_client)
    link_id, _ = _connect_and_link(test_client, token, provider)

    _sync(test_client, token, link_id)

    [connection] = test_client.get("/api/v1/bank-feeds/connections", headers=_auth(token)).json()
    assert connection["accounts"][0]["last_synced_at"] is not None


def test_sync_unlinked_account_returns_409(test_client, provider) -> None:
    token = _register_and_login(test_client)
    link_id = _connect(test_client, token, provider)["accounts"][0]["id"]

    response = _sync(test_client, token, link_id)

    assert response.status_code == 409


def test_sync_expired_connection_returns_409(test_client, provider) -> None:
    provider.session_valid_until = datetime.now(timezone.utc) - timedelta(days=1)
    token = _register_and_login(test_client)
    link_id, _ = _connect_and_link(test_client, token, provider)

    response = _sync(test_client, token, link_id)

    assert response.status_code == 409
    assert provider.fetch_calls == []


def test_sync_provider_error_returns_502_and_keeps_last_synced(test_client, provider) -> None:
    token = _register_and_login(test_client)
    link_id, _ = _connect_and_link(test_client, token, provider)
    provider.error = BankFeedError("down", status_code=500)

    response = _sync(test_client, token, link_id)

    assert response.status_code == 502
    [connection] = test_client.get("/api/v1/bank-feeds/connections", headers=_auth(token)).json()
    assert connection["accounts"][0]["last_synced_at"] is None


def test_sync_another_users_link_returns_404(test_client, provider) -> None:
    owner = _register_and_login(test_client, "owner@example.com")
    link_id, _ = _connect_and_link(test_client, owner, provider)
    other = _register_and_login(test_client, "other@example.com")

    response = _sync(test_client, other, link_id)

    assert response.status_code == 404
