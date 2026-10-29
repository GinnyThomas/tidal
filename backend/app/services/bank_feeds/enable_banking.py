# app/services/bank_feeds/enable_banking.py
#
# Purpose: BankFeedProvider implementation for Enable Banking
# (https://enablebanking.com/docs/api/reference/).
#
# Why Enable Banking: it covers UK and Spanish banks (Monzo, Virgin Money,
# Santander España) and its "restricted" production mode is free for
# connecting your OWN accounts. Offering feeds to other users needs a
# commercial contract — that's a licensing question, not a code one.
#
# Authentication: every request carries a JWT we sign ourselves with the
# application's RSA private key (RS256). The application id goes in the
# header as `kid`; Enable Banking verifies with the certificate uploaded when
# the application was registered. Tokens may live at most 24 hours — we mint
# a fresh one per request, valid for an hour, so there's no expiry to track.
#
# Sandbox vs production is decided by the application, not the URL: a
# sandbox application only sees Enable Banking's mock banks.

import time
from datetime import date as date_, datetime
from decimal import Decimal

import httpx
from jose import jwt

from app.services.bank_feeds.provider import (
    AuthStart,
    BankFeedError,
    FeedTransaction,
    Institution,
    LinkedSession,
    ProviderAccount,
)

API_URL = "https://api.enablebanking.com"
_TOKEN_LIFETIME_SECONDS = 3600
_PAYEE_MAX_LENGTH = 100  # transactions.payee is String(100)
# Safety stop: a runaway continuation_key loop must never hang a request.
_MAX_PAGES = 50


class EnableBankingProvider:
    name = "enable_banking"

    def __init__(self, application_id: str, private_key_pem: str, client: httpx.Client | None = None) -> None:
        self._application_id = application_id
        # Env vars often store a PEM on one line with literal "\n" sequences.
        self._private_key = private_key_pem.replace("\\n", "\n")
        self._client = client or httpx.Client(base_url=API_URL, timeout=30.0)

    # --- HTTP plumbing ---

    def _token(self) -> str:
        now = int(time.time())
        return jwt.encode(
            {"iss": "enablebanking.com", "aud": "api.enablebanking.com", "iat": now, "exp": now + _TOKEN_LIFETIME_SECONDS},
            self._private_key,
            algorithm="RS256",
            headers={"kid": self._application_id},
        )

    def _request(self, method: str, path: str, **kwargs) -> dict:
        try:
            response = self._client.request(
                method, path, headers={"Authorization": f"Bearer {self._token()}"}, **kwargs,
            )
        except httpx.HTTPError as exc:
            raise BankFeedError(f"Enable Banking unreachable: {exc}") from exc
        if response.is_error:
            # Log-safe: the body is Enable Banking's error message, no bank data.
            raise BankFeedError(
                f"Enable Banking {method} {path} failed ({response.status_code}): {response.text[:200]}",
                status_code=response.status_code,
            )
        return response.json()

    # --- BankFeedProvider ---

    def list_institutions(self, country: str) -> list[Institution]:
        body = self._request("GET", "/aspsps", params={"country": country, "psu_type": "personal"})
        return [
            Institution(
                name=aspsp["name"],
                country=aspsp["country"],
                logo=aspsp.get("logo"),
                max_consent_days=int(aspsp.get("maximum_consent_validity", 0)) // 86400,
            )
            for aspsp in body.get("aspsps", [])
        ]

    def start_auth(
        self,
        institution: str,
        country: str,
        redirect_url: str,
        state: str,
        valid_until: datetime,
    ) -> AuthStart:
        body = self._request("POST", "/auth", json={
            "access": {"valid_until": valid_until.isoformat()},
            "aspsp": {"name": institution, "country": country},
            "state": state,
            "redirect_url": redirect_url,
            "psu_type": "personal",
        })
        return AuthStart(url=body["url"])

    def create_session(self, code: str) -> LinkedSession:
        body = self._request("POST", "/sessions", json={"code": code})
        return LinkedSession(
            session_id=body["session_id"],
            valid_until=datetime.fromisoformat(body["access"]["valid_until"]),
            accounts=[_map_account(account) for account in body.get("accounts", [])],
        )

    def fetch_transactions(self, account_uid: str, date_from: date_) -> list[FeedTransaction]:
        params: dict[str, str] = {"date_from": date_from.isoformat(), "transaction_status": "BOOK"}
        transactions: list[FeedTransaction] = []
        for _ in range(_MAX_PAGES):
            body = self._request("GET", f"/accounts/{account_uid}/transactions", params=params)
            transactions.extend(_map_transaction(tx) for tx in body.get("transactions", []))
            continuation_key = body.get("continuation_key")
            if not continuation_key:
                break
            params = {**params, "continuation_key": continuation_key}
        return transactions


# =============================================================================
# Mapping Enable Banking JSON → provider-neutral dataclasses
# =============================================================================


def _map_account(account: dict) -> ProviderAccount:
    iban = (account.get("account_id") or {}).get("iban")
    return ProviderAccount(
        uid=account["uid"],
        identification_hash=account.get("identification_hash"),
        name=account.get("name"),
        currency=account.get("currency"),
        iban_last4=iban[-4:] if iban else None,
    )


def _map_transaction(tx: dict) -> FeedTransaction:
    is_debit = tx.get("credit_debit_indicator") == "DBIT"
    amount = Decimal(tx["transaction_amount"]["amount"])
    # Amounts arrive unsigned; the indicator carries the direction. abs()
    # guards against a bank that signs them anyway.
    signed = -abs(amount) if is_debit else abs(amount)

    # Money out → who we paid (creditor). Money in → who paid us (debtor).
    counterparty = tx.get("creditor") if is_debit else tx.get("debtor")
    remittance = " ".join(tx.get("remittance_information") or []).strip() or None
    payee = (counterparty or {}).get("name") or remittance or "Unknown"

    notes = remittance
    if len(payee) > _PAYEE_MAX_LENGTH:
        # Same rule as CSV import: keep the full text in the note.
        notes = payee
        payee = payee[:_PAYEE_MAX_LENGTH]

    tx_date = tx.get("booking_date") or tx.get("value_date") or tx.get("transaction_date")
    return FeedTransaction(
        date=date_.fromisoformat(tx_date),
        amount=signed,
        payee=payee,
        notes=notes,
        external_id=tx.get("entry_reference") or tx.get("transaction_id"),
    )
