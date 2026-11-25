# app/services/bank_feeds/provider.py
#
# Purpose: The provider-neutral shape of a bank feed.
#
# Reading bank data under UK Open Banking / EU PSD2 goes through a licensed
# aggregator (an AISP). Routers only ever talk to the protocols below, so
# adding an aggregator means writing one new class — nothing else changes.
#
# Providers come in two flows, named by their `flow` attribute:
#
#   "consent" (ConsentFlowProvider, e.g. Enable Banking) — Tidal runs the
#   bank consent itself:
#     1. list_institutions(country)  → banks the user can pick from
#     2. start_auth(...)             → URL of the bank's consent screen
#     3. bank redirects back with ?code=...&state=...
#     4. create_session(code)        → a session with the consented accounts
#
#   "pre_connected" (PreConnectedProvider, e.g. BankSync) — the user connects
#   banks in the provider's own app; Tidal reads them with an API key:
#     1. list_connections()          → banks already connected, with accounts
#
# Both then share:
#     fetch_transactions(uid, …)     → booked transactions for one account

from dataclasses import dataclass
from datetime import date as date_, datetime
from decimal import Decimal
from typing import Literal, Protocol


class BankFeedError(Exception):
    """The provider call failed. status_code is None for network errors.

    retry_after is set (in seconds) when the provider rate-limited us (429).
    """

    def __init__(self, message: str, status_code: int | None = None, retry_after: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.retry_after = retry_after


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


@dataclass(frozen=True)
class RemoteConnection:
    """A bank the user connected in a pre-connected provider's own app."""

    # Provider's id for this bank connection; stored as BankConnection.session_id.
    connection_id: str
    institution_name: str
    country: str
    # When the bank consent runs out; None if the provider doesn't say.
    valid_until: datetime | None
    # The provider says the user must reconnect before data can flow again.
    needs_reauth: bool
    accounts: list[ProviderAccount]


class BankFeedProvider(Protocol):
    """What every provider can do, whichever flow it uses."""

    # Stored on each BankConnection, e.g. "enable_banking", "banksync".
    name: str
    # Shown in the UI, e.g. "BankSync".
    display_name: str
    flow: Literal["consent", "pre_connected"]

    def fetch_transactions(self, account_uid: str, date_from: date_) -> list[FeedTransaction]: ...


class ConsentFlowProvider(BankFeedProvider, Protocol):
    """Tidal runs the bank consent: pick a bank, redirect, exchange a code."""

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


class PreConnectedProvider(BankFeedProvider, Protocol):
    """Banks are connected in the provider's own app; Tidal only reads them."""

    def list_connections(self) -> list[RemoteConnection]: ...
