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
    # Deliberately NOT ge=0, unlike every other amount field in this app.
    # This is the raw bank-signed value (negative = debit, positive =
    # credit) straight off the CSV, before routers.transactions.import_transactions
    # takes abs() of it to get the stored magnitude. A ge=0 constraint here
    # would reject every legitimate expense row before that conversion runs.
    amount: Decimal = Field(...)
    payee: str = Field(..., max_length=100)
    notes: Optional[str] = None
    external_id: Optional[str] = Field(default=None, max_length=255)
    # Optional — lets the user assign a category during the review step
    # instead of editing every row after import.
    category_id: Optional[uuid.UUID] = None


class TransactionImportRequest(BaseModel):
    """Request body for POST /api/v1/transactions/import."""

    account_id: uuid.UUID
    transactions: list[ImportTransactionRow]


class SkippedRow(BaseModel):
    """A single row skipped during import, with the reason."""

    row_index: int
    reason: str


class TransactionImportResponse(BaseModel):
    """Response body for POST /api/v1/transactions/import."""

    created: int
    skipped_duplicates: int
    skipped_rows: list[SkippedRow] = []


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
