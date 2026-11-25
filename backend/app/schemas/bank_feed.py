# app/schemas/bank_feed.py
#
# Purpose: Pydantic v2 schemas for the /api/v1/bank-feeds endpoints.

import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class ProviderResponse(BaseModel):
    """A bank feed provider the current user may use."""

    name: str
    display_name: str
    # consent: Tidal runs the bank consent (pick a bank, redirect back).
    # pre_connected: banks are connected in the provider's own app.
    flow: Literal["consent", "pre_connected"]


class InstitutionResponse(BaseModel):
    name: str
    country: str
    logo: Optional[str]
    max_consent_days: int


class ConnectionStart(BaseModel):
    """Request body for POST /api/v1/bank-feeds/connections."""

    institution: str = Field(..., max_length=100)
    country: str = Field(..., min_length=2, max_length=2)


class ConnectionStartResponse(BaseModel):
    connection_id: uuid.UUID
    # Send the user here to approve access at their bank.
    auth_url: str


class ConnectionComplete(BaseModel):
    """Request body for POST /api/v1/bank-feeds/connections/complete — the bank redirect's query params."""

    code: str = Field(..., max_length=1000)
    state: str = Field(..., max_length=64)


class BankAccountLinkResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: Optional[str]
    currency: Optional[str]
    iban_last4: Optional[str]
    # Linked Tidal account, or None.
    account_id: Optional[uuid.UUID]
    last_synced_at: Optional[datetime]
    last_sync_attempt_at: Optional[datetime]
    # Why the last sync failed; None after a success.
    last_sync_error: Optional[str]


class BankConnectionResponse(BaseModel):
    id: uuid.UUID
    # Which provider created it, e.g. "enable_banking" or "banksync".
    provider: str
    institution_name: str
    institution_country: str
    status: Literal["active", "expired"]
    valid_until: Optional[datetime]
    accounts: list[BankAccountLinkResponse]


class BankAccountLinkUpdate(BaseModel):
    """Request body for PUT /api/v1/bank-feeds/links/{id}. None unlinks."""

    account_id: Optional[uuid.UUID]
