# app/schemas/schedule.py
#
# Purpose: Pydantic v2 schemas for Schedule request and response shapes.
#
# Schemas:
#   ScheduleFrequency  — enum of valid recurrence frequencies
#   ScheduleCreate     — request body for POST /api/v1/schedules
#   ScheduleResponse   — response for all schedule endpoints
#   ScheduleUpdate     — partial update for PUT /api/v1/schedules/{id}
#
# Amount serialisation:
#   Same pattern as Transaction: @field_serializer converts Decimal → str with
#   exactly 2 decimal places. Prevents float precision loss in JavaScript.

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_serializer


class ScheduleFrequency(str, Enum):
    """
    Valid recurrence frequencies for a schedule.
    Inherits from str so enum values compare directly to strings —
    ScheduleFrequency.weekly == "weekly" is True.
    """

    daily = "daily"
    weekly = "weekly"
    monthly = "monthly"
    every_n_days = "every_n_days"
    quarterly = "quarterly"
    annually = "annually"


class ScheduleType(str, Enum):
    regular = "regular"
    transfer = "transfer"


class ScheduleCreate(BaseModel):
    """
    Request body for POST /api/v1/schedules.

    Fields not here (id, user_id, created_at, updated_at) are set server-side.
    """

    account_id: uuid.UUID
    category_id: Optional[uuid.UUID] = None
    schedule_type: ScheduleType = ScheduleType.regular
    from_account_id: Optional[uuid.UUID] = None
    to_account_id: Optional[uuid.UUID] = None
    name: str = Field(..., max_length=100)
    payee: Optional[str] = Field(default=None, max_length=100)
    amount: Decimal = Field(...)
    currency: str = Field(default="GBP", max_length=3)
    frequency: ScheduleFrequency
    # interval: "every N" multiplier. interval=2 + weekly → every 2 weeks.
    interval: int = Field(default=1, ge=1)
    # day_of_month: which day to fire on for monthly/quarterly/annually (1–31).
    # If omitted, uses the day number from start_date.
    day_of_month: Optional[int] = Field(default=None, ge=1, le=31)
    start_date: date
    end_date: Optional[date] = None
    auto_generate: bool = True
    active: bool = True
    group: Optional[str] = Field(default=None, max_length=50)
    note: Optional[str] = None


class ScheduleResponse(BaseModel):
    """
    Response body for all schedule endpoints.

    amount is serialised as a string (not a JSON number) to avoid IEEE 754
    precision loss on the JavaScript client side — same pattern as transactions.

    category_name and category_icon are denormalised from the Category row
    so the client can display the category without a separate lookup request.
    They are populated by the router — not read from the Schedule ORM object
    directly (which is why we build a dict in the router rather than returning
    the ORM object straight to Pydantic).
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    account_id: uuid.UUID
    category_id: Optional[uuid.UUID]
    schedule_type: str
    from_account_id: Optional[uuid.UUID]
    to_account_id: Optional[uuid.UUID]
    name: str
    payee: Optional[str]
    amount: Decimal
    currency: str
    frequency: str
    interval: int
    day_of_month: Optional[int]
    start_date: date
    end_date: Optional[date]
    auto_generate: bool
    active: bool
    group: Optional[str]
    note: Optional[str]
    created_at: datetime
    # Computed by the router from the recurrence engine
    next_occurrence: Optional[date] = None
    # Denormalised from Category — populated by the router helper
    category_name: Optional[str]
    category_icon: Optional[str]

    @field_serializer("amount")
    def serialize_amount(self, value: Decimal) -> str:
        """Return amount as a string with exactly 2 decimal places."""
        return str(value.quantize(Decimal("0.01")))


class ScheduleUpdate(BaseModel):
    """
    Request body for PUT /api/v1/schedules/{id}.

    All fields are Optional — partial update pattern (exclude_unset=True).
    Cannot change user_id via this endpoint.
    """

    account_id: Optional[uuid.UUID] = None
    category_id: Optional[uuid.UUID] = None
    schedule_type: Optional[ScheduleType] = None
    from_account_id: Optional[uuid.UUID] = None
    to_account_id: Optional[uuid.UUID] = None
    name: Optional[str] = Field(default=None, max_length=100)
    payee: Optional[str] = Field(default=None, max_length=100)
    amount: Optional[Decimal] = None
    currency: Optional[str] = Field(default=None, max_length=3)
    frequency: Optional[ScheduleFrequency] = None
    interval: Optional[int] = Field(default=None, ge=1)
    day_of_month: Optional[int] = Field(default=None, ge=1, le=31)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    auto_generate: Optional[bool] = None
    active: Optional[bool] = None
    group: Optional[str] = Field(default=None, max_length=50)
    note: Optional[str] = None
