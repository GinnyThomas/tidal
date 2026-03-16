# app/schemas/user.py
#
# Purpose: Pydantic v2 schemas for User-related request and response shapes.
#
# Schemas vs Models — a critical distinction:
#
#   Models (app/models/)  → define the DATABASE table shape
#   Schemas (app/schemas/) → define the API REQUEST/RESPONSE shape
#
# They are deliberately separate because:
#   - The database model has fields we MUST NOT expose over the API (password_hash)
#   - The API accepts fields that don't exist as columns (plain-text password)
#   - The API response might reshape or rename fields in future
#
# Pydantic v2 validates data automatically when an instance is created.
# If validation fails (wrong type, missing field, constraint violated),
# Pydantic raises ValidationError. FastAPI catches this and returns
# HTTP 422 Unprocessable Entity with a detailed error body.

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserCreate(BaseModel):
    """
    Shape of the request body for POST /api/v1/auth/register.

    Pydantic validates these fields before our endpoint code runs:
      - EmailStr: checks the email is a valid format (has @, has domain, etc.)
        Requires the `email-validator` package to be installed.
      - Field(min_length=8): rejects passwords shorter than 8 characters.
        8 is a common minimum — short enough not to annoy users, long enough
        to make brute-force attacks expensive.

    If validation fails, FastAPI returns 422 automatically — we write no
    error-handling code for these cases.
    """

    email: EmailStr
    password: str = Field(min_length=8)


class UserResponse(BaseModel):
    """
    Shape of the JSON body we return after registration, or when fetching user info.

    Note what is NOT here: password_hash. We never send it in a response.
    FastAPI's response_model=UserResponse acts as a filter — even if the
    endpoint accidentally returns a full User ORM object, FastAPI will
    only serialise the fields listed here.

    ConfigDict(from_attributes=True):
        Without this, Pydantic expects a dict (like {"email": "..."}). But
        SQLAlchemy ORM instances are objects with attributes, not dicts.
        from_attributes=True tells Pydantic: "read field values from object
        attributes, not just from dict keys." This lets us write:
            UserResponse.model_validate(user_orm_object)
        and have it work correctly.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    default_currency: str
    timezone: str
    created_at: datetime
