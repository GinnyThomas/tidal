# app/schemas/account.py
#
# Purpose: Pydantic v2 schemas for Account request and response shapes.
#
# Three schemas for three different purposes:
#
#   AccountCreate  — what the client sends when creating an account
#   AccountResponse — what we return to the client (read-only fields included)
#   AccountUpdate  — what the client sends when updating (all fields optional)
#
# AccountType enum:
#   We validate account_type at the schema layer rather than the database layer.
#   This gives us a clear Python enum to work with in application code,
#   plus automatic 422 errors when the client sends an invalid type.
#   The model stores account_type as a plain String(20) column.

import uuid
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_serializer


class AccountType(str, Enum):
    """
    Valid account types. Inherits from str so the enum values compare directly
    to strings — e.g. AccountType.checking == "checking" is True.
    This makes it easy to store in the database without calling .value everywhere.
    """

    checking = "checking"
    savings = "savings"
    credit_card = "credit_card"
    cash = "cash"
    mortgage = "mortgage"
    loan = "loan"


class AccountCreate(BaseModel):
    """
    Request body for POST /api/v1/accounts.

    Only includes fields the user sets at creation time.
    Fields not here (id, user_id, is_manual, is_active, timestamps) are
    set automatically by the server — the client has no say in them.
    """

    name: str = Field(max_length=100)
    account_type: AccountType
    currency: str = Field(default="GBP", max_length=3)
    # Decimal accepts both "12.50" (string) and 12.50 (number) from JSON.
    # We use Decimal over float to preserve exact decimal precision.
    current_balance: Decimal = Field(default=Decimal("0"))
    institution: Optional[str] = Field(default=None, max_length=100)
    note: Optional[str] = None


class AccountResponse(BaseModel):
    """
    Response body for all Account endpoints.

    ConfigDict(from_attributes=True): lets Pydantic read from a SQLAlchemy
    ORM object's attributes rather than expecting a dict. Same pattern as
    UserResponse — necessary for FastAPI to serialise ORM instances.

    current_balance serialisation:
    CLAUDE.md specifies "amounts as strings (not floats)". Pydantic v2 would
    serialise Decimal as a JSON number by default. The @field_serializer below
    converts it to a string (e.g. "100.00") before the response is sent.
    This prevents precision loss when JavaScript parses the JSON — JS's
    number type is IEEE 754 double, which can't represent all decimals exactly.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    account_type: str
    currency: str
    current_balance: Decimal
    calculated_balance: Decimal = Decimal("0")
    is_manual: bool
    institution: Optional[str]
    is_active: bool
    note: Optional[str]
    created_at: datetime

    @field_serializer("current_balance", "calculated_balance")
    def serialize_balance(self, value: Decimal) -> str:
        """Return balance as a string with exactly 2 decimal places."""
        scaled = value.quantize(Decimal("0.01"))
        return str(scaled)


class AccountUpdate(BaseModel):
    """
    Request body for PUT /api/v1/accounts/{id}.

    All fields are Optional — a PATCH-style partial update. The router uses
    model_dump(exclude_unset=True) to only update fields the client actually
    sent, leaving everything else unchanged.

    Note: user_id, is_manual, is_active, and timestamps are not updatable
    by the client — they are server-managed fields.
    """

    name: Optional[str] = Field(default=None, max_length=100)
    account_type: Optional[AccountType] = None
    currency: Optional[str] = Field(default=None, max_length=3)
    current_balance: Optional[Decimal] = None
    institution: Optional[str] = Field(default=None, max_length=100)
    note: Optional[str] = None
