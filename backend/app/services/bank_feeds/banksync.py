# app/services/bank_feeds/banksync.py
#
# Purpose: PreConnectedProvider implementation for BankSync
# (https://banksync.io/docs/api/reference).
#
# Why BankSync: Enable Banking's free mode is EEA-only, and the UK
# aggregators (TrueLayer, Yapily, Salt Edge) sell production access to
# companies, not individuals. BankSync resells Salt Edge's FCA-authorised
# UK access for a few dollars a month.
#
# The flow differs from Enable Banking: the user connects and re-consents
# banks inside BankSync's own app, and Tidal reads them with an API key.
# So there is no redirect or code exchange here, only list_connections().
#
# The key belongs to ONE BankSync workspace, so whoever holds it reads that
# person's banks. The registry in __init__.py only offers this provider to
# the user named in BANKSYNC_OWNER_EMAIL.
#
# Field notes (checked against a real Monzo connection on 2026-11-23):
#   - amount is negative for money out (= creditAmount - debitAmount),
#     on current, savings and credit card accounts alike.
#   - reference is the bank's own transaction id (Monzo: tx_…), the same
#     value the Monzo CSV template stores, so it is our external_id.
#   - saltedgeConsentExpiresAt / reauthPendingAt / connectionStatus come
#     back on each bank but are NOT in the published docs, so every one
#     of them is optional here.
#   - Rate limit is 10 requests/minute on the Standard plan; a 429 carries
#     Retry-After, which we pass up rather than sleeping inside a request.

import json
from datetime import date as date_, datetime
from decimal import Decimal

import httpx

from app.services.bank_feeds.provider import (
    BankFeedError,
    FeedTransaction,
    ProviderAccount,
    RemoteConnection,
)

API_URL = "https://api.banksync.io"
_PAYEE_MAX_LENGTH = 100  # transactions.payee is String(100)
# Safety stop: a cursor that never ends must never hang a request.
_MAX_PAGES = 50
# BankSync only reaches UK banks through Salt Edge today.
_DEFAULT_COUNTRY = "GB"


class BankSyncProvider:
    name = "banksync"
    display_name = "BankSync"
    flow = "pre_connected"

    def __init__(self, api_key: str, client: httpx.Client | None = None) -> None:
        self._client = client or httpx.Client(base_url=API_URL, timeout=30.0)
        self._headers = {"X-API-Key": api_key}

    # --- HTTP plumbing ---

    def _get(self, path: str, params: dict | None = None) -> dict:
        try:
            response = self._client.get(path, params=params, headers=self._headers)
        except httpx.HTTPError as exc:
            raise BankFeedError(f"BankSync unreachable: {exc}") from exc
        if response.status_code == 429:
            raise BankFeedError(
                f"BankSync rate limit on GET {path}",
                status_code=429,
                retry_after=_parse_retry_after(response.headers.get("Retry-After")),
            )
        if response.is_error:
            # Log-safe: the body is BankSync's error message, no bank data.
            raise BankFeedError(
                f"BankSync GET {path} failed ({response.status_code}): {response.text[:200]}",
                status_code=response.status_code,
            )
        # parse_float=Decimal keeps amounts exact: 5.75 never becomes 5.7499999…
        return json.loads(response.text, parse_float=Decimal)

    # --- PreConnectedProvider ---

    def list_connections(self) -> list[RemoteConnection]:
        banks = self._get("/v1/banks").get("data") or []
        connections: list[RemoteConnection] = []
        for bank in banks:
            if bank.get("deletedAt"):
                continue
            accounts = self._get(f"/v1/banks/{bank['id']}/accounts").get("data") or []
            connections.append(_map_bank(bank, accounts))
        return connections

    def fetch_transactions(self, account_uid: str, date_from: date_) -> list[FeedTransaction]:
        bank_id, account_id = account_uid.split(":", 1)
        path = f"/v1/banks/{bank_id}/accounts/{account_id}/transactions"
        params: dict[str, str] = {"from": date_from.isoformat()}
        transactions: list[FeedTransaction] = []
        for _ in range(_MAX_PAGES):
            body = self._get(path, params=params)
            transactions.extend(
                _map_transaction(tx) for tx in body.get("data") or [] if not tx.get("pending")
            )
            meta = body.get("meta") or {}
            if not meta.get("hasMore") or not meta.get("cursor"):
                break
            params = {**params, "cursor": meta["cursor"]}
        return transactions


# =============================================================================
# Mapping BankSync JSON → provider-neutral dataclasses
# =============================================================================


def _parse_retry_after(value: str | None) -> int | None:
    try:
        return int(value) if value is not None else None
    except ValueError:
        return None


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    # Python 3.11+ accepts the trailing "Z".
    return datetime.fromisoformat(value)


def _country(bank: dict) -> str:
    # institutionId looks like "monzo_oauth_client_gb": the suffix is the country.
    suffix = (bank.get("institutionId") or "").rsplit("_", 1)[-1]
    return suffix.upper() if len(suffix) == 2 and suffix.isalpha() else _DEFAULT_COUNTRY


def _map_bank(bank: dict, accounts: list[dict]) -> RemoteConnection:
    status = bank.get("connectionStatus") or {}
    return RemoteConnection(
        connection_id=str(bank["id"]),
        institution_name=bank.get("name") or "Unknown bank",
        country=_country(bank),
        valid_until=_parse_datetime(bank.get("saltedgeConsentExpiresAt")),
        needs_reauth=bool(bank.get("reauthPendingAt")) or status.get("connected") is False,
        accounts=[_map_account(bank, account) for account in accounts],
    )


def _map_account(bank: dict, account: dict) -> ProviderAccount:
    number = (account.get("accountNumber") or "").replace(" ", "")
    return ProviderAccount(
        # Transactions are read per bank AND account, so the uid carries both.
        uid=f"{bank['id']}:{account['id']}",
        identification_hash=None,
        name=account.get("accountName"),
        currency=account.get("currency"),
        # Monzo pots have no number — BankSync puts the pot name there instead.
        iban_last4=number[-4:] if len(number) >= 4 and number[-4:].isdigit() else None,
    )


def _map_transaction(tx: dict) -> FeedTransaction:
    description = (tx.get("description") or "").strip() or None
    merchant = (tx.get("merchantName") or "").strip() or None

    # Payee is who was paid: for a bank transfer, description is the payment
    # reference ("Allowance") and merchantName the person ("Grace Thomas").
    payee = merchant or description or "Unknown"
    notes = description if description and description.lower() != payee.lower() else None

    if len(payee) > _PAYEE_MAX_LENGTH:
        # Same rule as CSV import: keep the full text in the note.
        notes = payee if notes is None else f"{payee} — {notes}"
        payee = payee[:_PAYEE_MAX_LENGTH]

    return FeedTransaction(
        date=date_.fromisoformat(tx["date"][:10]),
        amount=Decimal(tx["amount"]),
        payee=payee,
        notes=notes,
        external_id=tx.get("reference") or str(tx["id"]),
    )
