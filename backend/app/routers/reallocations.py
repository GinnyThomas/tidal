# app/routers/reallocations.py
#
# Purpose: HTTP endpoints for managing reallocations.
#
# Endpoints:
#   POST /api/v1/reallocations              → create reallocation (201)
#   GET  /api/v1/reallocations              → list reallocations for current user (200)
#                                             supports ?month=&year= filters
#   GET  /api/v1/reallocations/{id}         → get single reallocation (200 or 404)
#
# Intentionally NO PUT, NO DELETE, NO PATCH:
#   Reallocations are an immutable audit trail. Once created, they cannot be
#   modified or removed. If the user made a mistake, the correct action is to
#   create a correcting reallocation (move the amount back). This keeps the
#   history honest and complete.
#
# Validation:
#   Both from_category_id and to_category_id must belong to the current user.
#   This prevents injecting a reallocation that references another user's
#   categories — same ownership-check pattern as accounts/transactions.
#
# Security model:
#   All endpoints require a valid JWT via Depends(get_current_user).
#   Every query scopes to current_user.id.

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.category import Category
from app.models.reallocation import Reallocation
from app.models.user import User
from app.schemas.reallocation import ReallocationCreate, ReallocationResponse
from app.services.auth import get_current_user


router = APIRouter(
    prefix="/api/v1/reallocations",
    tags=["reallocations"],
)


# =============================================================================
# Helpers
# =============================================================================


def _get_reallocation_or_404(
    reallocation_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session,
) -> Reallocation:
    """
    Fetch a reallocation by ID scoped to the given user.
    Raises 404 if not found or belongs to another user.
    """
    reallocation = (
        db.query(Reallocation)
        .filter(
            Reallocation.id == reallocation_id,
            Reallocation.user_id == user_id,
        )
        .first()
    )
    if reallocation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reallocation not found.",
        )
    return reallocation


def _get_category_or_404(
    category_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session,
) -> Category:
    """
    Validate that a non-deleted category exists and belongs to the current user.
    Used on create to prevent cross-user category injection.
    """
    category = (
        db.query(Category)
        .filter(
            Category.id == category_id,
            Category.user_id == user_id,
            Category.deleted_at.is_(None),
        )
        .first()
    )
    if category is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found.",
        )
    return category


# =============================================================================
# Endpoints
# =============================================================================


@router.post(
    "",
    response_model=ReallocationResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_reallocation(
    reallocation_in: ReallocationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Reallocation:
    """
    Records a budget reallocation — moving planned spend between two categories.

    Both categories must belong to the current user. The reason must be
    non-empty (enforced by ReallocationCreate's field_validator before this
    function is called; Pydantic returns 422 automatically if it fails).

    Returns the created reallocation with 201 Created.
    """
    _get_category_or_404(reallocation_in.from_category_id, current_user.id, db)
    _get_category_or_404(reallocation_in.to_category_id, current_user.id, db)

    reallocation = Reallocation(
        user_id=current_user.id,
        from_category_id=reallocation_in.from_category_id,
        to_category_id=reallocation_in.to_category_id,
        amount=reallocation_in.amount,
        currency=reallocation_in.currency,
        reason=reallocation_in.reason,
        month=reallocation_in.month,
        year=reallocation_in.year,
    )
    db.add(reallocation)
    db.commit()
    db.refresh(reallocation)
    return reallocation


@router.get(
    "",
    response_model=list[ReallocationResponse],
)
def list_reallocations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    month: Optional[int] = Query(default=None, ge=1, le=12),
    year: Optional[int] = Query(default=None, ge=2000, le=2100),
) -> list[Reallocation]:
    """
    Returns all reallocations for the current user.

    Optional filters:
      month — return only reallocations for this calendar month (1–12)
      year  — return only reallocations for this calendar year
      These are typically combined: ?month=1&year=2026

    No pagination — reallocation lists are expected to be short
    (a few entries per month at most).
    """
    query = db.query(Reallocation).filter(
        Reallocation.user_id == current_user.id,
    )

    if month is not None:
        query = query.filter(Reallocation.month == month)

    if year is not None:
        query = query.filter(Reallocation.year == year)

    return query.order_by(Reallocation.created_at).all()


@router.get(
    "/{reallocation_id}",
    response_model=ReallocationResponse,
)
def get_reallocation(
    reallocation_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Reallocation:
    """
    Returns a single reallocation by ID.

    Returns 404 if not found or belongs to another user.
    """
    return _get_reallocation_or_404(reallocation_id, current_user.id, db)
