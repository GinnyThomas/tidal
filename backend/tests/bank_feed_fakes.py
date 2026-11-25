# tests/bank_feed_fakes.py
#
# Fake bank feed providers shared by the bank feed tests (router, sync
# service and daily job), so no test ever talks to a real bank, plus helpers
# that seed a linked bank account straight into the test database.

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection
from app.models.user import User

from app.services.bank_feeds.provider import (
    AuthStart,
    BankFeedError,
    FeedTransaction,
    Institution,
    LinkedSession,
    ProviderAccount,
    RemoteConnection,
)


# =============================================================================
# Fake provider
# =============================================================================


class FakeProvider:
    name = "fake"
    display_name = "Fake Consent"
    flow = "consent"

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


class FakePreConnectedProvider:
    name = "fake_pre"
    display_name = "Fake Pre-connected"
    flow = "pre_connected"

    def __init__(self) -> None:
        self.connections = [_remote()]
        self.transactions: list[FeedTransaction] = []
        self.fetch_calls: list[tuple[str, date]] = []
        self.error: BankFeedError | None = None

    def list_connections(self) -> list[RemoteConnection]:
        if self.error:
            raise self.error
        return self.connections

    def fetch_transactions(self, account_uid: str, date_from: date) -> list[FeedTransaction]:
        self.fetch_calls.append((account_uid, date_from))
        if self.error:
            raise self.error
        return self.transactions


def _remote(
    connection_id: str = "bank-1",
    accounts: list[ProviderAccount] | None = None,
    valid_until: datetime | None = None,
    needs_reauth: bool = False,
    name: str = "Monzo",
) -> RemoteConnection:
    return RemoteConnection(
        connection_id=connection_id,
        institution_name=name,
        country="GB",
        valid_until=valid_until if valid_until is not None else datetime.now(timezone.utc) + timedelta(days=180),
        needs_reauth=needs_reauth,
        accounts=accounts if accounts is not None else [
            ProviderAccount(uid="bank-1:acc-1", identification_hash=None, name="Personal Account",
                            currency="GBP", iban_last4="3177"),
        ],
    )


def _feed_tx(external_id: str = "e1", amount: str = "-12.34", payee: str = "Tesco") -> FeedTransaction:
    return FeedTransaction(
        date=date(2026, 9, 5), amount=Decimal(amount), payee=payee, notes=None, external_id=external_id,
    )


# =============================================================================
# Seeding the test database
# =============================================================================


def seed_user(test_client, db: Session, email: str = "user@example.com") -> User:
    test_client.post("/api/v1/auth/register", json={"email": email, "password": "securepassword"})
    return db.query(User).filter(User.email == email).one()


def seed_link(
    db: Session,
    user: User,
    provider: str = "fake",
    linked: bool = True,
    valid_until: datetime | None = None,
    uid: str = "uid-1",
) -> BankAccountLink:
    """A bank connection with one bank account, linked to a new Tidal account."""
    account = Account(user_id=user.id, name="Monzo Current", account_type="checking", currency="GBP")
    db.add(account)
    connection = BankConnection(
        user_id=user.id, provider=provider, institution_name="Monzo", institution_country="GB",
        status="active", session_id=f"sess-{uuid.uuid4()}",
        valid_until=valid_until or datetime.now(timezone.utc) + timedelta(days=90),
    )
    link = BankAccountLink(user_id=user.id, provider_account_uid=uid, name="Current", currency="GBP")
    connection.links.append(link)
    db.add(connection)
    db.flush()
    if linked:
        link.account_id = account.id
    db.commit()
    return link
