# tests/test_banksync.py
#
# Tests for app/services/bank_feeds/banksync.py — the BankSync API client.
# No network: every HTTP call goes through httpx.MockTransport.
#
# The JSON shapes below are trimmed copies of real BankSync responses for a
# Monzo connection (checked on 2026-11-23), with made-up ids and amounts.

import json
from datetime import date, datetime, timezone
from decimal import Decimal

import httpx
import pytest

from app.services.bank_feeds.banksync import BankSyncProvider
from app.services.bank_feeds.provider import BankFeedError

API_KEY = "bsk_test_key"
BANK_ID = "111"
ACCOUNT_ID = "222"


def _provider(handler) -> tuple[BankSyncProvider, list[httpx.Request]]:
    """Provider whose HTTP calls are answered by `handler`; returns the request log too."""
    requests: list[httpx.Request] = []

    def recording(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    client = httpx.Client(base_url="https://api.banksync.io", transport=httpx.MockTransport(recording))
    return BankSyncProvider(API_KEY, client=client), requests


def _ok(data, meta: dict | None = None) -> httpx.Response:
    body = {"success": True, "data": data}
    if meta is not None:
        body["meta"] = meta
    return httpx.Response(200, json=body)


def _bank(**overrides) -> dict:
    bank = {
        "id": BANK_ID,
        "name": "Monzo",
        "source": "saltedge",
        "institutionId": "monzo_oauth_client_gb",
        "deletedAt": None,
        "reauthPendingAt": None,
        "connectionStatus": {"status": "healthy", "detectedAt": "2026-11-23T17:37:08.134Z"},
        "saltedgeConsentExpiresAt": "2027-05-22T17:35:17Z",
    }
    return {**bank, **overrides}


def _account(**overrides) -> dict:
    account = {
        "id": ACCOUNT_ID,
        "bankId": BANK_ID,
        "accountNumber": "12343177",
        "accountName": "Personal Account",
        "accountType": "checking",
        "currency": "GBP",
    }
    return {**account, **overrides}


def _tx(**overrides) -> dict:
    tx = {
        "id": "333",
        "date": "2026-11-17",
        "description": "Co-op",
        "creditAmount": 0,
        "debitAmount": 5.75,
        "amount": -5.75,
        "currency": "GBP",
        "pending": False,
        "reference": "tx_0000ABC",
    }
    return {**tx, **overrides}


def _transactions_handler(pages: list[list[dict]]):
    """Serves `pages` in order, linking them with cursors c1, c2, …"""
    def handler(request: httpx.Request) -> httpx.Response:
        cursor = request.url.params.get("cursor")
        index = int(cursor[1:]) if cursor else 0
        has_more = index + 1 < len(pages)
        return _ok(pages[index], meta={
            "count": len(pages[index]),
            "cursor": f"c{index + 1}" if has_more else "",
            "hasMore": has_more,
        })
    return handler


# =============================================================================
# Authentication and errors
# =============================================================================


def test_requests_carry_the_api_key_header() -> None:
    provider, requests = _provider(lambda r: _ok([]))

    provider.list_connections()

    assert requests[0].headers["X-API-Key"] == API_KEY


def test_http_error_raises_bank_feed_error_with_status() -> None:
    provider, _ = _provider(lambda r: httpx.Response(401, json={"success": False, "error": "Invalid API key"}))

    with pytest.raises(BankFeedError) as exc_info:
        provider.list_connections()

    assert exc_info.value.status_code == 401


def test_rate_limit_raises_bank_feed_error_with_retry_after() -> None:
    provider, _ = _provider(lambda r: httpx.Response(429, headers={"Retry-After": "42"}, json={"success": False}))

    with pytest.raises(BankFeedError) as exc_info:
        provider.list_connections()

    assert exc_info.value.status_code == 429
    assert exc_info.value.retry_after == 42


def test_network_error_raises_bank_feed_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    provider, _ = _provider(handler)

    with pytest.raises(BankFeedError) as exc_info:
        provider.list_connections()

    assert exc_info.value.status_code is None


# =============================================================================
# list_connections
# =============================================================================


def _connections_handler(banks: list[dict], accounts: list[dict]):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/banks":
            return _ok(banks)
        if request.url.path == f"/v1/banks/{BANK_ID}/accounts":
            return _ok(accounts)
        return httpx.Response(404, json={"success": False, "error": "not found"})
    return handler


def test_list_connections_maps_banks_and_accounts() -> None:
    provider, _ = _provider(_connections_handler([_bank()], [_account()]))

    [connection] = provider.list_connections()

    assert connection.connection_id == BANK_ID
    assert connection.institution_name == "Monzo"
    assert connection.country == "GB"
    assert connection.valid_until == datetime(2027, 5, 22, 17, 35, 17, tzinfo=timezone.utc)
    assert connection.needs_reauth is False
    [account] = connection.accounts
    # Transactions need both ids, so the account uid carries both.
    assert account.uid == f"{BANK_ID}:{ACCOUNT_ID}"
    assert account.name == "Personal Account"
    assert account.currency == "GBP"
    assert account.iban_last4 == "3177"


def test_pot_account_number_is_not_treated_as_digits() -> None:
    # Monzo pots have no account number; BankSync puts the pot name there.
    provider, _ = _provider(_connections_handler([_bank()], [_account(accountNumber="House repairs")]))

    [connection] = provider.list_connections()

    assert connection.accounts[0].iban_last4 is None


def test_reauth_pending_marks_connection_as_needing_reauth() -> None:
    provider, _ = _provider(_connections_handler([_bank(reauthPendingAt="2026-11-30T00:00:00Z")], []))

    [connection] = provider.list_connections()

    assert connection.needs_reauth is True


def test_disconnected_status_marks_connection_as_needing_reauth() -> None:
    bank = _bank(connectionStatus={"connected": False, "status": "error"})
    provider, _ = _provider(_connections_handler([bank], []))

    [connection] = provider.list_connections()

    assert connection.needs_reauth is True


def test_missing_consent_expiry_gives_none() -> None:
    # saltedgeConsentExpiresAt isn't in BankSync's published docs, so it may vanish.
    bank = _bank()
    del bank["saltedgeConsentExpiresAt"]
    provider, _ = _provider(_connections_handler([bank], []))

    [connection] = provider.list_connections()

    assert connection.valid_until is None


def test_unparseable_consent_expiry_gives_none() -> None:
    # An undocumented field: a value we can't read must not break the refresh.
    provider, _ = _provider(_connections_handler([_bank(saltedgeConsentExpiresAt="next spring")], [_account()]))

    [connection] = provider.list_connections()

    assert connection.valid_until is None


def test_malformed_bank_raises_bank_feed_error() -> None:
    bank = _bank()
    del bank["id"]
    provider, _ = _provider(_connections_handler([bank], [_account()]))

    with pytest.raises(BankFeedError):
        provider.list_connections()


def test_deleted_banks_are_skipped() -> None:
    provider, requests = _provider(_connections_handler([_bank(deletedAt="2026-11-22T00:00:00Z")], []))

    assert provider.list_connections() == []
    assert [r.url.path for r in requests] == ["/v1/banks"]


# =============================================================================
# fetch_transactions
# =============================================================================


def test_fetch_transactions_reads_the_account_from_date_from() -> None:
    provider, requests = _provider(_transactions_handler([[_tx()]]))

    provider.fetch_transactions(f"{BANK_ID}:{ACCOUNT_ID}", date(2026, 8, 25))

    assert requests[0].url.path == f"/v1/banks/{BANK_ID}/accounts/{ACCOUNT_ID}/transactions"
    assert requests[0].url.params["from"] == "2026-08-25"


def test_fetch_transactions_follows_cursor_pages() -> None:
    pages = [[_tx(id="1", reference="tx_1")], [_tx(id="2", reference="tx_2")]]
    provider, requests = _provider(_transactions_handler(pages))

    transactions = provider.fetch_transactions(f"{BANK_ID}:{ACCOUNT_ID}", date(2026, 8, 25))

    assert [t.external_id for t in transactions] == ["tx_1", "tx_2"]
    assert requests[1].url.params["cursor"] == "c1"


def test_fetch_transactions_stops_after_page_limit_with_an_error() -> None:
    # A cursor that never ends must not hang the request. Nor may it pass as
    # a complete sync: last_synced_at would move on and skip the rest for good.
    def handler(request: httpx.Request) -> httpx.Response:
        return _ok([], meta={"count": 0, "cursor": "again", "hasMore": True})

    provider, requests = _provider(handler)

    with pytest.raises(BankFeedError):
        provider.fetch_transactions(f"{BANK_ID}:{ACCOUNT_ID}", date(2026, 8, 25))

    assert len(requests) == 50


def test_money_out_is_negative_and_exact() -> None:
    provider, _ = _provider(_transactions_handler([[_tx(amount=-0.1 - 0.2)]]))

    [tx] = provider.fetch_transactions(f"{BANK_ID}:{ACCOUNT_ID}", date(2026, 8, 25))

    # Parsed straight from the JSON text, so no float rounding creeps in.
    assert tx.amount == Decimal(json.dumps(-0.1 - 0.2))
    assert tx.amount < 0
    assert tx.date == date(2026, 11, 17)


def test_external_id_is_the_banks_own_reference() -> None:
    # For Monzo this is the tx_… id, which the Monzo CSV template also stores,
    # so a sync and an earlier CSV import dedup against each other.
    provider, _ = _provider(_transactions_handler([[_tx(id="333", reference="tx_0000ABC")]]))

    [tx] = provider.fetch_transactions(f"{BANK_ID}:{ACCOUNT_ID}", date(2026, 8, 25))

    assert tx.external_id == "tx_0000ABC"


def test_external_id_falls_back_to_banksync_id() -> None:
    raw = _tx(id="333")
    del raw["reference"]
    provider, _ = _provider(_transactions_handler([[raw]]))

    [tx] = provider.fetch_transactions(f"{BANK_ID}:{ACCOUNT_ID}", date(2026, 8, 25))

    assert tx.external_id == "333"


def test_external_id_ignores_a_payment_reference() -> None:
    # Outside Monzo, `reference` can be the text the payer typed. Two
    # "Allowance" payments in one account must not dedup against each other.
    provider, _ = _provider(_transactions_handler([[
        _tx(id="1", reference="Allowance"),
        _tx(id="2", reference="Allowance"),
    ]]))

    transactions = provider.fetch_transactions(f"{BANK_ID}:{ACCOUNT_ID}", date(2026, 8, 25))

    assert [tx.external_id for tx in transactions] == ["1", "2"]


def test_non_json_response_raises_bank_feed_error() -> None:
    provider, _ = _provider(lambda r: httpx.Response(200, text="<html>maintenance</html>"))

    with pytest.raises(BankFeedError):
        provider.list_connections()


def test_malformed_transaction_raises_bank_feed_error() -> None:
    provider, _ = _provider(_transactions_handler([[_tx(amount=None)]]))

    with pytest.raises(BankFeedError):
        provider.fetch_transactions(f"{BANK_ID}:{ACCOUNT_ID}", date(2026, 8, 25))


def test_pending_transactions_are_skipped() -> None:
    provider, _ = _provider(_transactions_handler([[_tx(pending=True), _tx(id="2", reference="tx_2")]]))

    transactions = provider.fetch_transactions(f"{BANK_ID}:{ACCOUNT_ID}", date(2026, 8, 25))

    assert [t.external_id for t in transactions] == ["tx_2"]


def test_payee_is_who_was_paid_with_description_in_notes() -> None:
    # Bank transfer: description is the payment reference, merchantName the person.
    raw = _tx(description="Allowance", merchantName="Grace Thomas")
    provider, _ = _provider(_transactions_handler([[raw]]))

    [tx] = provider.fetch_transactions(f"{BANK_ID}:{ACCOUNT_ID}", date(2026, 8, 25))

    assert tx.payee == "Grace Thomas"
    assert tx.notes == "Allowance"


def test_payee_falls_back_to_description_without_notes() -> None:
    provider, _ = _provider(_transactions_handler([[_tx(description="Co-op")]]))

    [tx] = provider.fetch_transactions(f"{BANK_ID}:{ACCOUNT_ID}", date(2026, 8, 25))

    assert tx.payee == "Co-op"
    assert tx.notes is None


def test_notes_skip_description_that_repeats_the_payee() -> None:
    raw = _tx(description="Grace Thomas", merchantName="Grace Thomas")
    provider, _ = _provider(_transactions_handler([[raw]]))

    [tx] = provider.fetch_transactions(f"{BANK_ID}:{ACCOUNT_ID}", date(2026, 8, 25))

    assert tx.notes is None


def test_long_payee_is_truncated_with_full_text_in_notes() -> None:
    long_name = "A" * 150
    provider, _ = _provider(_transactions_handler([[_tx(description=long_name)]]))

    [tx] = provider.fetch_transactions(f"{BANK_ID}:{ACCOUNT_ID}", date(2026, 8, 25))

    assert tx.payee == "A" * 100
    assert tx.notes == long_name


def test_transaction_with_no_names_gets_unknown_payee() -> None:
    raw = _tx()
    del raw["description"]
    provider, _ = _provider(_transactions_handler([[raw]]))

    [tx] = provider.fetch_transactions(f"{BANK_ID}:{ACCOUNT_ID}", date(2026, 8, 25))

    assert tx.payee == "Unknown"
