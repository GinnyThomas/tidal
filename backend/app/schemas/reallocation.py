# app/schemas/reallocation.py
#
# Purpose: Pydantic v2 schemas for Reallocation request and response shapes.
#
# Schemas:
#   ReallocationCreate   — request body for POST /api/v1/reallocations
#   ReallocationResponse — response for all reallocation endpoints
#
# Key validation:
#   reason cannot be empty or whitespace-only. A blank reason defeats the
#   purpose of the audit trail — every adjustment must be explained.
#   We use a @field_validator to strip whitespace and reject empty strings,
#   returning 422 Unprocessable Entity if validation fails.
#
# Amount serialisation:
#   Same pattern as Transaction and Schedule: @field_serializer converts
#   Decimal → str with exactly 2 decimal places to prevent float precision
#   loss on the JavaScript client.
#
# No update schema:
#   Reallocations are immutable. There is no ReallocationUpdate.

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator


class ReallocationCreate(BaseModel):
    """
    Request body for POST /api/v1/reallocations.

    from_category_id and to_category_id can be the same category (though
    that would be a no-op — the router does not prohibit it, the user is
    responsible for meaningful adjustments).

    month must be 1–12. year is any valid calendar year.
    reason must be non-empty after stripping whitespace.
    """

    from_category_id: uuid.UUID
    to_category_id: uuid.UUID
    amount: Decimal = Field(..., gt=0)
    currency: str = Field(default="GBP", max_length=3)
    reason: str
    month: int = Field(..., ge=1, le=12)
    year: int = Field(..., ge=2000, le=2100)

    @field_validator("reason")
    @classmethod
    def reason_must_not_be_empty(cls, v: str) -> str:
        """
        Strips surrounding whitespace and rejects the result if empty.

        Why a validator rather than Field(min_length=1)?
          Field(min_length=1) would accept a reason that is all spaces.
          This validator strips first, then checks — "   " fails, "hello" passes.
        """
        stripped = v.strip()
        if not stripped:
            raise ValueError("reason cannot be empty or whitespace only.")
        return stripped


class ReallocationResponse(BaseModel):
    """
    Response body for all reallocation endpoints.

    amount is serialised as a string (not a JSON number) to avoid IEEE 754
    precision loss on the JavaScript client side.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    from_category_id: uuid.UUID
    to_category_id: uuid.UUID
    amount: Decimal
    currency: str
    reason: str
    month: int
    year: int
    created_at: datetime

    @field_serializer("amount")
    def serialize_amount(self, value: Decimal) -> str:
        """Return amount as a string with exactly 2 decimal places."""
        return str(value.quantize(Decimal("0.01")))
