# app/services/bank_feeds/provider.py
#
# Purpose: The provider-neutral shape of a bank feed.
#
# Reading bank data under UK Open Banking / EU PSD2 goes through a licensed
# aggregator (an AISP). Routers only ever talk to the BankFeedProvider
# protocol below, so swapping Enable Banking for TrueLayer, GoCardless, etc.
# means writing one new class — nothing else changes.
#
# The flow every aggregator shares:
#   1. list_institutions(country)  → banks the user can pick from
#   2. start_auth(...)             → URL of the bank's consent screen
#   3. bank redirects back with ?code=...&state=...
#   4. create_session(code)        → a session with the consented accounts
#   5. fetch_transactions(uid, …)  → booked transactions for one account

from dataclasses import dataclass
from datetime import date as date_, datetime
from decimal import Decimal
from typing import Protocol


class BankFeedError(Exception):
    """The provider call failed. status_code is None for network errors."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class Institution:
    name: str
    country: str
    logo: str | None
    # Longest consent the bank allows; a consent request must not exceed it.
    max_consent_days: int


@dataclass(frozen=True)
class AuthStart:
    # Where to send the user to approve access at their bank.
    url: str


@dataclass(frozen=True)
class ProviderAccount:
    # Provider's id for this account; only valid while the session is.
    uid: str
    # Stable across sessions — lets a re-consent find the same account again.
    identification_hash: str | None
    name: str | None
    currency: str | None
    iban_last4: str | None


@dataclass(frozen=True)
class LinkedSession:
    session_id: str
    valid_until: datetime
    accounts: list[ProviderAccount]


@dataclass(frozen=True)
class FeedTransaction:
    """A booked transaction. amount is bank-signed: negative = money out."""

    date: date_
    amount: Decimal
    payee: str
    notes: str | None
    external_id: str | None


class BankFeedProvider(Protocol):
    name: str

    def list_institutions(self, country: str) -> list[Institution]: ...

    def start_auth(
        self,
        institution: str,
        country: str,
        redirect_url: str,
        state: str,
        valid_until: datetime,
    ) -> AuthStart: ...

    def create_session(self, code: str) -> LinkedSession: ...

    def fetch_transactions(self, account_uid: str, date_from: date_) -> list[FeedTransaction]: ...
