# app/routers/budgets.py
#
# Purpose: API endpoints for managing budgets and monthly overrides.
#
# Budgets are monthly spending targets for variable categories (groceries,
# eating out, clothing). They complement schedules — schedules handle fixed
# recurring transactions, budgets handle discretionary spending targets.
#
# Endpoints:
#   POST   /api/v1/budgets                          — create a budget (201)
#   GET    /api/v1/budgets                          — list budgets, ?year= filter
#   GET    /api/v1/budgets/{id}                     — single budget with overrides
#   PUT    /api/v1/budgets/{id}                     — update default_amount/currency
#   DELETE /api/v1/budgets/{id}                     — hard delete
#   POST   /api/v1/budgets/{id}/overrides           — upsert a month override
#   DELETE /api/v1/budgets/{id}/overrides/{month}   — remove a month override
#
# Unlike transactions and schedules, budgets use hard delete — no deleted_at.
# The unique constraint (user_id, category_id, year) prevents duplicates.

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.budget import Budget, BudgetOverride
from app.models.user import User
from app.schemas.budget import (
    BudgetCreate,
    BudgetOverrideCreate,
    BudgetResponse,
    BudgetUpdate,
)
from app.services.auth import get_current_user

router = APIRouter(
    prefix="/api/v1/budgets",
    tags=["budgets"],
)


# =============================================================================
# Helpers
# =============================================================================


def _get_budget_or_404(
    budget_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session,
) -> Budget:
    """Fetch a budget by id, scoped to the user. Raises 404 if not found."""
    budget = (
        db.query(Budget)
        .filter(
            Budget.id == budget_id,
            Budget.user_id == user_id,
        )
        .first()
    )
    if budget is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Budget not found",
        )
    return budget


# =============================================================================
# Endpoints
# =============================================================================


@router.post("", status_code=status.HTTP_201_CREATED, response_model=BudgetResponse)
def create_budget(
    data: BudgetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Budget:
    """Create a new budget for a category/year. Returns 409 if one already exists."""
    budget = Budget(
        user_id=current_user.id,
        category_id=data.category_id,
        year=data.year,
        default_amount=data.default_amount,
        currency=data.currency,
    )
    db.add(budget)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A budget already exists for this category and year",
        )
    db.refresh(budget)
    return budget


@router.get("", response_model=list[BudgetResponse])
def list_budgets(
    year: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Budget]:
    """List all budgets for the current user. Optional ?year= filter."""
    query = db.query(Budget).filter(Budget.user_id == current_user.id)
    if year is not None:
        query = query.filter(Budget.year == year)
    return query.order_by(Budget.year, Budget.created_at).all()


@router.get("/{budget_id}", response_model=BudgetResponse)
def get_budget(
    budget_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Budget:
    """Get a single budget with its monthly overrides."""
    return _get_budget_or_404(budget_id, current_user.id, db)


@router.put("/{budget_id}", response_model=BudgetResponse)
def update_budget(
    budget_id: uuid.UUID,
    data: BudgetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Budget:
    """Update a budget's default_amount and/or currency."""
    budget = _get_budget_or_404(budget_id, current_user.id, db)
    if data.default_amount is not None:
        budget.default_amount = data.default_amount
    if data.currency is not None:
        budget.currency = data.currency
    db.commit()
    db.refresh(budget)
    return budget


@router.delete("/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_budget(
    budget_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Hard-delete a budget and all its overrides."""
    budget = _get_budget_or_404(budget_id, current_user.id, db)
    db.delete(budget)
    db.commit()


@router.post(
    "/{budget_id}/overrides",
    status_code=status.HTTP_201_CREATED,
    response_model=BudgetResponse,
)
def set_override(
    budget_id: uuid.UUID,
    data: BudgetOverrideCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Budget:
    """
    Upsert a month override — create if it doesn't exist, update if it does.

    Returns the full budget (with all overrides) so the client doesn't need
    a separate GET to see the updated state.
    """
    budget = _get_budget_or_404(budget_id, current_user.id, db)

    # Check if an override already exists for this month
    existing = (
        db.query(BudgetOverride)
        .filter(
            BudgetOverride.budget_id == budget.id,
            BudgetOverride.month == data.month,
        )
        .first()
    )

    if existing:
        # Update the existing override
        existing.amount = data.amount
    else:
        # Create a new override
        override = BudgetOverride(
            budget_id=budget.id,
            month=data.month,
            amount=data.amount,
        )
        db.add(override)

    db.commit()
    db.refresh(budget)
    return budget


@router.delete(
    "/{budget_id}/overrides/{month}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_override(
    budget_id: uuid.UUID,
    month: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Remove a month override — the budget reverts to default_amount for that month."""
    budget = _get_budget_or_404(budget_id, current_user.id, db)

    override = (
        db.query(BudgetOverride)
        .filter(
            BudgetOverride.budget_id == budget.id,
            BudgetOverride.month == month,
        )
        .first()
    )
    if override is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Override not found for this month",
        )

    db.delete(override)
    db.commit()
