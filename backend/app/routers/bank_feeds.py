# app/routers/bank_feeds.py
#
# Purpose: Open Banking bank feeds — connect a bank, link its accounts to
# Tidal accounts, and pull in transactions.
#
# Endpoints:
#   GET    /api/v1/bank-feeds/institutions?country=GB → banks to choose from
#   POST   /api/v1/bank-feeds/connections             → start consent (201, returns bank URL)
#   POST   /api/v1/bank-feeds/connections/complete    → finish consent after the bank redirect
#   GET    /api/v1/bank-feeds/connections             → user's connections + their accounts
#   DELETE /api/v1/bank-feeds/connections/{id}        → forget a connection (204)
#   PUT    /api/v1/bank-feeds/links/{id}              → link/unlink a bank account to a Tidal account
#   POST   /api/v1/bank-feeds/links/{id}/sync         → import booked transactions
#
# The consent round trip:
#   Tidal ──POST /connections──▶ provider gives a bank URL; we store a random
#   `state` with a pending connection. The browser goes to the bank, the user
#   approves, and the bank redirects to {frontend}/bank-feeds/callback?code&state.
#   The frontend posts both here. We only accept a state that belongs to the
#   CURRENT user's pending connection, then clear it — so a forged or replayed
#   callback can't attach a bank session to the wrong account.
#
# Sync writes through services/importer.py, the same code path as CSV import,
# so the two never double-import the same transaction.

import logging
import secrets
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.database import get_db
from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection
from app.models.user import User
from app.schemas.bank_feed import (
    BankAccountLinkResponse,
    BankAccountLinkUpdate,
    BankConnectionResponse,
    ConnectionComplete,
    ConnectionStart,
    ConnectionStartResponse,
    InstitutionResponse,
)
from app.schemas.csv_mapping import TransactionImportResponse
from app.services.auth import get_current_user
from app.services.bank_feeds import get_bank_feed_provider
from app.services.bank_feeds.provider import BankFeedError, BankFeedProvider
from app.services.importer import ImportRow, import_rows

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/bank-feeds",
    tags=["bank-feeds"],
)

# Banks allow 90–180 days; never ask for more than the longer of the two.
_MAX_CONSENT_DAYS = 180
# How far back the first sync of an account reaches.
_FIRST_SYNC_DAYS = 90
# Later syncs re-read this much of the previous window: banks can book a
# transaction days after it happened. Dedup drops the ones we already have.
_SYNC_OVERLAP_DAYS = 7


# =============================================================================
# Helpers
# =============================================================================


def _bad_gateway(exc: BankFeedError) -> HTTPException:
    logger.error("Bank feed provider error: %s", exc)
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="The bank feed provider returned an error. Please try again.",
    )


def _as_utc(value: datetime) -> datetime:
    # SQLite (tests) returns naive datetimes; PostgreSQL returns aware ones.
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _is_expired(connection: BankConnection) -> bool:
    return connection.valid_until is None or _as_utc(connection.valid_until) <= datetime.now(timezone.utc)


def _connection_response(connection: BankConnection) -> dict:
    return {
        "id": connection.id,
        "institution_name": connection.institution_name,
        "institution_country": connection.institution_country,
        "status": "expired" if _is_expired(connection) else "active",
        "valid_until": connection.valid_until,
        "accounts": sorted(connection.links, key=lambda link: link.name or ""),
    }


def _get_link_or_404(link_id: uuid.UUID, user_id: uuid.UUID, db: Session) -> BankAccountLink:
    link = db.query(BankAccountLink).filter(
        BankAccountLink.id == link_id,
        BankAccountLink.user_id == user_id,
    ).first()
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bank account not found.")
    return link


def _get_account_or_404(account_id: uuid.UUID, user_id: uuid.UUID, db: Session) -> Account:
    account = db.query(Account).filter(
        Account.id == account_id,
        Account.user_id == user_id,
        Account.deleted_at.is_(None),
    ).first()
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")
    return account


# =============================================================================
# Institutions
# =============================================================================


@router.get("/institutions", response_model=list[InstitutionResponse])
def list_institutions(
    country: str = Query(..., min_length=2, max_length=2),
    current_user: User = Depends(get_current_user),
    provider: BankFeedProvider = Depends(get_bank_feed_provider),
) -> list:
    """Banks available in a country, e.g. ?country=GB or ?country=ES."""
    try:
        return provider.list_institutions(country.upper())
    except BankFeedError as exc:
        raise _bad_gateway(exc)


# =============================================================================
# Connections
# =============================================================================


@router.post("/connections", response_model=ConnectionStartResponse, status_code=status.HTTP_201_CREATED)
def start_connection(
    connection_in: ConnectionStart,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    provider: BankFeedProvider = Depends(get_bank_feed_provider),
) -> dict:
    """Creates a pending connection and returns the bank's consent URL."""
    country = connection_in.country.upper()
    try:
        institutions = provider.list_institutions(country)
    except BankFeedError as exc:
        raise _bad_gateway(exc)

    institution = next((i for i in institutions if i.name == connection_in.institution), None)
    if institution is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bank not found.")

    consent_days = min(institution.max_consent_days, _MAX_CONSENT_DAYS)
    # 128 bits of randomness, URL-safe — an attacker can't guess another user's.
    state = secrets.token_urlsafe(32)

    try:
        auth = provider.start_auth(
            institution=institution.name,
            country=country,
            redirect_url=f"{settings.frontend_base_url}/bank-feeds/callback",
            state=state,
            valid_until=datetime.now(timezone.utc) + timedelta(days=consent_days),
        )
    except BankFeedError as exc:
        raise _bad_gateway(exc)

    connection = BankConnection(
        user_id=current_user.id,
        provider=provider.name,
        institution_name=institution.name,
        institution_country=country,
        state=state,
        status="pending",
    )
    db.add(connection)
    db.commit()
    return {"connection_id": connection.id, "auth_url": auth.url}


@router.post("/connections/complete", response_model=BankConnectionResponse)
def complete_connection(
    complete_in: ConnectionComplete,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    provider: BankFeedProvider = Depends(get_bank_feed_provider),
) -> dict:
    """Exchanges the bank redirect's code for a session and records its accounts."""
    connection = db.query(BankConnection).filter(
        BankConnection.state == complete_in.state,
        BankConnection.user_id == current_user.id,
        BankConnection.status == "pending",
    ).first()
    if connection is None:
        # Unknown, another user's, or already used — all look the same.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bank connection not found.")

    try:
        session = provider.create_session(complete_in.code)
    except BankFeedError as exc:
        raise _bad_gateway(exc)

    connection.session_id = session.session_id
    connection.valid_until = session.valid_until
    connection.status = "active"
    connection.state = None  # single use
    for account in session.accounts:
        connection.links.append(BankAccountLink(
            user_id=current_user.id,
            provider_account_uid=account.uid,
            identification_hash=account.identification_hash,
            name=account.name[:100] if account.name else None,
            currency=account.currency,
            iban_last4=account.iban_last4,
        ))
    db.commit()
    logger.info("Bank connection %s completed with %d account(s)", connection.id, len(session.accounts))
    return _connection_response(connection)


@router.get("/connections", response_model=list[BankConnectionResponse])
def list_connections(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list:
    """The user's completed connections. Abandoned (pending) ones are hidden."""
    connections = (
        db.query(BankConnection)
        .options(selectinload(BankConnection.links))
        .filter(BankConnection.user_id == current_user.id, BankConnection.status == "active")
        .order_by(BankConnection.created_at)
        .all()
    )
    return [_connection_response(c) for c in connections]


@router.delete("/connections/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_connection(
    connection_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Forgets a connection and its account links. Imported transactions stay."""
    connection = db.query(BankConnection).filter(
        BankConnection.id == connection_id,
        BankConnection.user_id == current_user.id,
    ).first()
    if connection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bank connection not found.")
    db.delete(connection)
    db.commit()


# =============================================================================
# Account links and sync
# =============================================================================


@router.put("/links/{link_id}", response_model=BankAccountLinkResponse)
def update_link(
    link_id: uuid.UUID,
    link_in: BankAccountLinkUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BankAccountLink:
    """Links a bank account to a Tidal account (or unlinks it with null)."""
    link = _get_link_or_404(link_id, current_user.id, db)

    if link_in.account_id is not None:
        account = _get_account_or_404(link_in.account_id, current_user.id, db)
        # Import uses the Tidal account's currency, so a mismatch would
        # silently relabel every amount (£12 becoming €12).
        if link.currency and link.currency != account.currency:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Bank account is in {link.currency} but the Tidal account is in {account.currency}.",
            )

    link.account_id = link_in.account_id
    db.commit()
    return link


@router.post("/links/{link_id}/sync", response_model=TransactionImportResponse)
def sync_link(
    link_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    provider: BankFeedProvider = Depends(get_bank_feed_provider),
) -> dict:
    """Imports booked transactions from the bank into the linked Tidal account."""
    link = _get_link_or_404(link_id, current_user.id, db)
    if link.account_id is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Link this bank account to a Tidal account first.")
    if _is_expired(link.connection):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bank consent has expired. Reconnect the bank.")
    account = _get_account_or_404(link.account_id, current_user.id, db)

    if link.last_synced_at is None:
        date_from = date.today() - timedelta(days=_FIRST_SYNC_DAYS)
    else:
        date_from = _as_utc(link.last_synced_at).date() - timedelta(days=_SYNC_OVERLAP_DAYS)

    try:
        feed = provider.fetch_transactions(link.provider_account_uid, date_from)
    except BankFeedError as exc:
        raise _bad_gateway(exc)

    rows = [
        ImportRow(date=tx.date, amount=tx.amount, payee=tx.payee, notes=tx.notes, external_id=tx.external_id)
        for tx in feed
    ]
    result = import_rows(db, current_user.id, account, rows)

    link.last_synced_at = datetime.now(timezone.utc)
    db.commit()
    logger.info(
        "Bank sync for link %s: %d fetched, %d created, %d duplicates",
        link.id, len(feed), result["created"], result["skipped_duplicates"],
    )
    return result
