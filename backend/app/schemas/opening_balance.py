# app/schemas/opening_balance.py

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_serializer


class OpeningBalanceCreate(BaseModel):
    group: str = Field(..., max_length=50)
    year: int
    opening_balance: Decimal
    currency: str = Field(default="GBP", max_length=3)


class OpeningBalanceUpdate(BaseModel):
    opening_balance: Optional[Decimal] = None
    currency: Optional[str] = Field(default=None, max_length=3)


class OpeningBalanceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    group: str
    year: int
    opening_balance: Decimal
    currency: str
    created_at: datetime
    updated_at: datetime

    @field_serializer("opening_balance")
    def serialize_amount(self, value: Decimal) -> str:
        return str(value.quantize(Decimal("0.01")))
