# app/schemas/category.py
#
# Purpose: Pydantic v2 schemas for Category request and response shapes.
#
# CategoryCreate  — what the client sends when creating a category
# CategoryResponse — what we return (includes server-set fields)
# CategoryUpdate  — partial update (all fields optional)
#
# Notably absent from CategoryCreate and CategoryUpdate:
#   - user_id: always taken from the JWT, never from the request body
#   - is_system: always False for user-created categories — cannot be overridden
#   - timestamps: server-managed
#
# parent_category_id is a UUID in Create/Update. Pydantic accepts UUIDs as
# strings from JSON and coerces them automatically.

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class CategoryCreate(BaseModel):
    """
    Request body for POST /api/v1/categories.

    Colour is expected as a 7-character hex string (#RRGGBB).
    We enforce max_length=7 but don't validate the # prefix or hex digits —
    that level of validation can be added later if needed.
    """

    name: str = Field(max_length=100)
    parent_category_id: Optional[uuid.UUID] = None
    colour: Optional[str] = Field(default=None, max_length=7)
    icon: Optional[str] = Field(default=None, max_length=50)
    is_hidden: bool = False
    is_income: bool = False
    group: Optional[str] = Field(default=None, max_length=50)


class CategoryResponse(BaseModel):
    """
    Response body for all Category endpoints.

    Includes is_system so the client knows which categories are protected
    and should not offer a "delete" option for them in the UI.

    from_attributes=True: reads from SQLAlchemy ORM objects, not just dicts.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    parent_category_id: Optional[uuid.UUID]
    colour: Optional[str]
    icon: Optional[str]
    is_system: bool
    is_hidden: bool
    is_income: bool
    group: Optional[str]
    created_at: datetime


class CategoryUpdate(BaseModel):
    """
    Request body for PUT /api/v1/categories/{id}.

    All CategoryCreate fields are optional — a partial update.
    The router uses model_dump(exclude_unset=True) so only sent fields change.

    Cannot change is_system via an update — it's not in this schema.
    """

    name: Optional[str] = Field(default=None, max_length=100)
    parent_category_id: Optional[uuid.UUID] = None
    colour: Optional[str] = Field(default=None, max_length=7)
    icon: Optional[str] = Field(default=None, max_length=50)
    is_hidden: Optional[bool] = None
    is_income: Optional[bool] = None
    group: Optional[str] = Field(default=None, max_length=50)
