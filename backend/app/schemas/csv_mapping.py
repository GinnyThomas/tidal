# app/schemas/csv_mapping.py
#
# Purpose: Pydantic v2 schemas for the CSV import and csv_mappings endpoints.

import uuid
from datetime import date as date_, datetime
from decimal import Decimal
from typing import Optional, Any

from pydantic import BaseModel, ConfigDict, Field, field_serializer


# =============================================================================
# Import endpoint schemas
# =============================================================================


class ImportTransactionRow(BaseModel):
    """One row of a CSV import — the normalised form sent by the frontend."""

    date: date_
    amount: Decimal = Field(...)
    payee: str = Field(..., max_length=100)
    notes: Optional[str] = None
    external_id: Optional[str] = Field(default=None, max_length=255)


class TransactionImportRequest(BaseModel):
    """Request body for POST /api/v1/transactions/import."""

    account_id: uuid.UUID
    transactions: list[ImportTransactionRow]


class TransactionImportResponse(BaseModel):
    """Response body for POST /api/v1/transactions/import."""

    created: int
    skipped_duplicates: int


# =============================================================================
# CSV mapping schemas
# =============================================================================


class CsvMappingCreate(BaseModel):
    """Request body for POST /api/v1/csv-mappings."""

    account_id: uuid.UUID
    name: str = Field(..., max_length=100)
    mapping_json: dict[str, Any]


class CsvMappingResponse(BaseModel):
    """Response for GET and POST /api/v1/csv-mappings."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    account_id: uuid.UUID
    name: str
    mapping_json: dict[str, Any]
    created_at: datetime
    updated_at: datetime
