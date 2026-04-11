# app/schemas/promotion.py
#
# Purpose: Pydantic v2 schemas for Promotion request and response shapes.
#
# PromotionResponse includes computed fields that are populated by the router:
#   days_remaining, required_monthly_payment, total_paid, remaining_balance, urgency

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_serializer


class PromotionType(str, Enum):
    balance_transfer = "balance_transfer"
    bnpl = "bnpl"
    deferred_interest = "deferred_interest"
    other = "other"


class PromotionCreate(BaseModel):
    """Request body for POST /api/v1/promotions."""

    name: str = Field(..., max_length=100)
    promotion_type: PromotionType
    account_id: Optional[uuid.UUID] = None
    original_balance: Decimal
    interest_rate: Decimal = Decimal("0.00")
    start_date: date
    end_date: date
    minimum_monthly_payment: Optional[Decimal] = None
    is_active: bool = True
    notes: Optional[str] = None


class PromotionUpdate(BaseModel):
    """Partial update for PUT /api/v1/promotions/{id}."""

    name: Optional[str] = Field(default=None, max_length=100)
    promotion_type: Optional[PromotionType] = None
    account_id: Optional[uuid.UUID] = None
    original_balance: Optional[Decimal] = None
    interest_rate: Optional[Decimal] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    minimum_monthly_payment: Optional[Decimal] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class PromotionResponse(BaseModel):
    """
    Response body for all promotion endpoints.

    Includes computed fields populated by the router:
      days_remaining            — days until end_date from today
      required_monthly_payment  — balance / months remaining (null if expired)
      total_paid                — sum of cleared+reconciled linked transactions
      remaining_balance         — original_balance - total_paid
      urgency                   — critical/warning/caution/ok/expired
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    account_id: Optional[uuid.UUID]
    name: str
    promotion_type: str
    original_balance: Decimal
    interest_rate: Decimal
    start_date: date
    end_date: date
    minimum_monthly_payment: Optional[Decimal]
    is_active: bool
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime

    # Computed fields — populated by the router, not from the ORM object
    days_remaining: int = 0
    required_monthly_payment: Optional[Decimal] = None
    total_paid: Decimal = Decimal("0")
    remaining_balance: Decimal = Decimal("0")
    urgency: str = "ok"

    @field_serializer(
        "original_balance", "interest_rate", "total_paid",
        "remaining_balance",
    )
    def serialize_decimal(self, value: Decimal) -> str:
        return str(value.quantize(Decimal("0.01")))

    @field_serializer("minimum_monthly_payment", "required_monthly_payment")
    def serialize_optional_decimal(self, value: Decimal | None) -> str | None:
        if value is None:
            return None
        return str(value.quantize(Decimal("0.01")))
