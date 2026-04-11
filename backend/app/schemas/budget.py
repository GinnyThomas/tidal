# app/schemas/budget.py
#
# Purpose: Pydantic v2 schemas for Budget request and response shapes.
#
# Schemas:
#   BudgetCreate          — request body for POST /api/v1/budgets
#   BudgetUpdate          — partial update for PUT /api/v1/budgets/{id}
#   BudgetResponse        — response for all budget endpoints (includes overrides)
#   BudgetOverrideCreate  — request body for POST /api/v1/budgets/{id}/overrides
#   BudgetOverrideResponse — nested inside BudgetResponse
#
# Amount serialisation:
#   Same pattern as other financial schemas — @field_serializer converts
#   Decimal to string with exactly 2 decimal places to prevent IEEE 754
#   precision loss on the JavaScript client side.

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_serializer


class BudgetOverrideCreate(BaseModel):
    """Request body for POST /api/v1/budgets/{id}/overrides — upsert a month override."""

    month: int = Field(..., ge=1, le=12)
    amount: Decimal


class BudgetOverrideResponse(BaseModel):
    """One month override within a BudgetResponse."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    budget_id: uuid.UUID
    month: int
    amount: Decimal

    @field_serializer("amount")
    def serialize_amount(self, value: Decimal) -> str:
        """Return amount as a string with exactly 2 decimal places."""
        return str(value.quantize(Decimal("0.01")))


class BudgetCreate(BaseModel):
    """
    Request body for POST /api/v1/budgets.

    Fields not here (id, user_id, created_at, updated_at) are set server-side.
    """

    category_id: uuid.UUID
    year: int
    default_amount: Decimal
    currency: str = Field(default="GBP", max_length=3)
    group: Optional[str] = Field(default=None, max_length=50)


class BudgetUpdate(BaseModel):
    """Partial update for PUT /api/v1/budgets/{id}."""

    default_amount: Optional[Decimal] = None
    currency: Optional[str] = Field(default=None, max_length=3)
    group: Optional[str] = Field(default=None, max_length=50)


class BudgetResponse(BaseModel):
    """
    Response body for all budget endpoints.

    default_amount is serialised as a string (not a JSON number) to avoid
    IEEE 754 precision loss on the JavaScript client side.

    overrides is a list of BudgetOverrideResponse — month-specific amounts
    that replace the default for individual months.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    category_id: uuid.UUID
    year: int
    default_amount: Decimal
    currency: str
    group: Optional[str]
    created_at: datetime
    updated_at: datetime
    overrides: list[BudgetOverrideResponse] = Field(default_factory=list)

    @field_serializer("default_amount")
    def serialize_amount(self, value: Decimal) -> str:
        """Return amount as a string with exactly 2 decimal places."""
        return str(value.quantize(Decimal("0.01")))
