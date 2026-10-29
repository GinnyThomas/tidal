# tests/test_enable_banking.py
#
# Tests for app/services/bank_feeds/enable_banking.py — the Enable Banking
# API client. No network: every HTTP call goes through httpx.MockTransport,
# and a throwaway RSA key lets us verify the JWT signature for real.

import json
from datetime import date, datetime, timezone
from decimal import Decimal

import httpx
import pytest
import rsa
from jose import jwt

from app.services.bank_feeds.enable_banking import EnableBankingProvider
from app.services.bank_feeds.provider import BankFeedError

APP_ID = "app-123"

# One small key for the whole module — key generation is the slow part.
_PUBLIC_KEY, _PRIVATE_KEY = rsa.newkeys(1024)
PRIVATE_PEM = _PRIVATE_KEY.save_pkcs1().decode()
PUBLIC_PEM = _PUBLIC_KEY.save_pkcs1().decode()


def _provider(handler) -> tuple[EnableBankingProvider, list[httpx.Request]]:
    """Provider whose HTTP calls are answered by `handler`; returns the request log too."""
    requests: list[httpx.Request] = []

    def recording(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    client = httpx.Client(
        base_url="https://api.enablebanking.com",
        transport=httpx.MockTransport(recording),
    )
    return EnableBankingProvider(APP_ID, PRIVATE_PEM, client=client), requests


def _ok(body: dict) -> httpx.Response:
    return httpx.Response(200, json=body)


# =============================================================================
# Authentication
# =============================================================================


def test_requests_carry_rs256_jwt_with_app_id_as_kid() -> None:
    provider, requests = _provider(lambda r: _ok({"aspsps": []}))
    provider.list_institutions("GB")

    auth = requests[0].headers["Authorization"]
    assert auth.startswith("Bearer ")
    token = auth.removeprefix("Bearer ")

    header = jwt.get_unverified_header(token)
    assert header["alg"] == "RS256"
    assert header["kid"] == APP_ID

    claims = jwt.decode(token, PUBLIC_PEM, algorithms=["RS256"], audience="api.enablebanking.com")
    assert claims["iss"] == "enablebanking.com"
    # Enable Banking rejects tokens that live longer than 24 hours.
    assert 0 < claims["exp"] - claims["iat"] <= 86400


def test_private_key_with_escaped_newlines_is_accepted() -> None:
    # Env vars (Railway) often hold a PEM on one line with literal "\n".
    escaped = PRIVATE_PEM.replace("\n", "\\n")
    client = httpx.Client(
        base_url="https://api.enablebanking.com",
        transport=httpx.MockTransport(lambda r: _ok({"aspsps": []})),
    )
    EnableBankingProvider(APP_ID, escaped, client=client).list_institutions("GB")


# =============================================================================
# Institutions
# =============================================================================


def test_list_institutions_maps_aspsps() -> None:
    provider, requests = _provider(lambda r: _ok({"aspsps": [
        {"name": "Monzo", "country": "GB", "logo": "https://logo/monzo.png",
         "maximum_consent_validity": 7776000, "psu_types": ["personal"]},
    ]}))

    institutions = provider.list_institutions("GB")

    assert requests[0].url.path == "/aspsps"
    assert requests[0].url.params["country"] == "GB"
    assert requests[0].url.params["psu_type"] == "personal"
    assert len(institutions) == 1
    assert institutions[0].name == "Monzo"
    assert institutions[0].country == "GB"
    assert institutions[0].logo == "https://logo/monzo.png"
    assert institutions[0].max_consent_days == 90


# =============================================================================
# Authorisation (consent) flow
# =============================================================================


def test_start_auth_posts_consent_request_and_returns_bank_url() -> None:
    provider, requests = _provider(lambda r: _ok({
        "url": "https://auth.enablebanking.com/ais/start?sessionid=abc",
        "authorization_id": "auth-1",
    }))
    valid_until = datetime(2027, 1, 1, tzinfo=timezone.utc)

    result = provider.start_auth(
        institution="Monzo", country="GB",
        redirect_url="https://tidal.app/bank-feeds/callback",
        state="state-xyz", valid_until=valid_until,
    )

    assert requests[0].method == "POST"
    assert requests[0].url.path == "/auth"
    body = json.loads(requests[0].content)
    assert body["aspsp"] == {"name": "Monzo", "country": "GB"}
    assert body["state"] == "state-xyz"
    assert body["redirect_url"] == "https://tidal.app/bank-feeds/callback"
    assert body["psu_type"] == "personal"
    assert datetime.fromisoformat(body["access"]["valid_until"]) == valid_until
    assert result.url == "https://auth.enablebanking.com/ais/start?sessionid=abc"


def test_create_session_returns_session_and_accounts() -> None:
    provider, requests = _provider(lambda r: _ok({
        "session_id": "sess-1",
        "access": {"valid_until": "2027-01-01T00:00:00+00:00"},
        "aspsp": {"name": "Monzo", "country": "GB"},
        "accounts": [{
            "uid": "acc-uid-1",
            "name": "Current Account",
            "currency": "GBP",
            "account_id": {"iban": "GB33BUKB20201555555555"},
            "identification_hash": "hash-1",
        }],
    }))

    session = provider.create_session("code-1")

    assert requests[0].url.path == "/sessions"
    assert json.loads(requests[0].content) == {"code": "code-1"}
    assert session.session_id == "sess-1"
    assert session.valid_until == datetime(2027, 1, 1, tzinfo=timezone.utc)
    assert len(session.accounts) == 1
    account = session.accounts[0]
    assert account.uid == "acc-uid-1"
    assert account.name == "Current Account"
    assert account.currency == "GBP"
    assert account.identification_hash == "hash-1"
    # Never keep the full IBAN — the last four digits are enough to recognise it.
    assert account.iban_last4 == "5555"


def test_create_session_tolerates_missing_optional_account_fields() -> None:
    provider, _ = _provider(lambda r: _ok({
        "session_id": "sess-1",
        "access": {"valid_until": "2027-01-01T00:00:00+00:00"},
        "accounts": [{"uid": "acc-uid-1"}],
    }))

    account = provider.create_session("code-1").accounts[0]

    assert account.name is None
    assert account.currency is None
    assert account.iban_last4 is None


# =============================================================================
# Transactions
# =============================================================================


def test_fetch_transactions_requests_booked_since_date() -> None:
    provider, requests = _provider(lambda r: _ok({"transactions": []}))

    provider.fetch_transactions("acc-uid-1", date(2026, 9, 1))

    assert requests[0].url.path == "/accounts/acc-uid-1/transactions"
    assert requests[0].url.params["date_from"] == "2026-09-01"
    assert requests[0].url.params["transaction_status"] == "BOOK"


def test_fetch_transactions_follows_continuation_key() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if "continuation_key" not in request.url.params:
            return _ok({"transactions": [_debit("e1")], "continuation_key": "page-2"})
        assert request.url.params["continuation_key"] == "page-2"
        return _ok({"transactions": [_debit("e2")]})

    provider, requests = _provider(handler)

    transactions = provider.fetch_transactions("acc-uid-1", date(2026, 9, 1))

    assert [t.external_id for t in transactions] == ["e1", "e2"]
    assert len(requests) == 2


def _debit(entry_reference: str | None = "e1", **overrides) -> dict:
    tx = {
        "entry_reference": entry_reference,
        "transaction_amount": {"currency": "GBP", "amount": "12.34"},
        "credit_debit_indicator": "DBIT",
        "status": "BOOK",
        "booking_date": "2026-09-05",
        "value_date": "2026-09-06",
        "creditor": {"name": "Tesco"},
        "debtor": {"name": "Ginny Thomas"},
        "remittance_information": ["CARD PAYMENT"],
    }
    tx.update(overrides)
    return tx


def _single(provider_tx: dict):
    provider, _ = _provider(lambda r: _ok({"transactions": [provider_tx]}))
    [tx] = provider.fetch_transactions("acc-uid-1", date(2026, 9, 1))
    return tx


def test_debit_maps_to_negative_amount_paid_to_creditor() -> None:
    tx = _single(_debit())

    assert tx.amount == Decimal("-12.34")
    assert tx.payee == "Tesco"
    assert tx.date == date(2026, 9, 5)
    assert tx.external_id == "e1"
    assert tx.notes == "CARD PAYMENT"


def test_credit_maps_to_positive_amount_received_from_debtor() -> None:
    tx = _single(_debit(
        credit_debit_indicator="CRDT",
        creditor={"name": "Ginny Thomas"},
        debtor={"name": "Employer Ltd"},
    ))

    assert tx.amount == Decimal("12.34")
    assert tx.payee == "Employer Ltd"


def test_payee_falls_back_to_remittance_information() -> None:
    tx = _single(_debit(creditor=None, remittance_information=["AMAZON MKTPLACE", "REF 123"]))

    assert tx.payee == "AMAZON MKTPLACE REF 123"


def test_payee_falls_back_to_unknown_when_bank_gives_nothing() -> None:
    tx = _single(_debit(creditor=None, remittance_information=None))

    assert tx.payee == "Unknown"
    assert tx.notes is None


def test_long_payee_is_truncated_with_full_text_kept_in_notes() -> None:
    long_name = "X" * 150
    tx = _single(_debit(creditor={"name": long_name}, remittance_information=None))

    assert len(tx.payee) == 100
    assert tx.notes == long_name


def test_external_id_falls_back_to_transaction_id() -> None:
    tx = _single(_debit(entry_reference=None, transaction_id="tx-9"))

    assert tx.external_id == "tx-9"


def test_external_id_is_none_when_bank_gives_no_id() -> None:
    # Dedup then falls back to the hash, like a CSV row without an id.
    tx = _single(_debit(entry_reference=None))

    assert tx.external_id is None


def test_date_falls_back_to_value_date() -> None:
    tx = _single(_debit(booking_date=None))

    assert tx.date == date(2026, 9, 6)


# =============================================================================
# Errors
# =============================================================================


def test_http_error_raises_bank_feed_error_with_status() -> None:
    provider, _ = _provider(lambda r: httpx.Response(401, json={"message": "Expired session"}))

    with pytest.raises(BankFeedError) as excinfo:
        provider.fetch_transactions("acc-uid-1", date(2026, 9, 1))

    assert excinfo.value.status_code == 401


def test_network_error_raises_bank_feed_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom")

    provider, _ = _provider(handler)

    with pytest.raises(BankFeedError) as excinfo:
        provider.list_institutions("GB")

    assert excinfo.value.status_code is None
