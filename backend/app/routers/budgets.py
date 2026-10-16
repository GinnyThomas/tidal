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
#   POST   /api/v1/budgets/copy-year                — copy a year's budgets into another
#   POST   /api/v1/budgets/{id}/overrides           — upsert a month override
#   DELETE /api/v1/budgets/{id}/overrides/{month}   — remove a month override
#
# Unlike transactions and schedules, budgets use hard delete — no deleted_at.
# The unique constraint (user_id, category_id, year) prevents duplicates.

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models.budget import Budget, BudgetOverride
from app.models.category import Category
from app.models.user import User
from app.schemas.budget import (
    BudgetCopyYear,
    BudgetCopyYearResult,
    BudgetCreate,
    BudgetOverrideBatch,
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


def _get_category_or_404(
    category_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session,
) -> Category:
    """Validate that a category exists, belongs to the user, and is not soft-deleted."""
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
            detail="Category not found",
        )
    return category


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


def _build_budget_response(budget: Budget, category: Category | None) -> dict:
    """
    Build a dict matching BudgetResponse, denormalising parent_category_id
    from the related Category row.

    Same pattern as _build_sched_response in schedules.py — parent_category_id
    is not a column on Budget, so we build a dict manually rather than
    returning the ORM object directly to Pydantic.
    """
    return {
        "id": budget.id,
        "user_id": budget.user_id,
        "category_id": budget.category_id,
        "parent_category_id": category.parent_category_id if category else None,
        "year": budget.year,
        "default_amount": budget.default_amount,
        "currency": budget.currency,
        "group": budget.group,
        "notes": budget.notes,
        "created_at": budget.created_at,
        "updated_at": budget.updated_at,
        "overrides": budget.overrides,
    }


def _lookup_category(
    category_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session,
) -> Category | None:
    """
    Fetch a category by id for response-building — returns None if the
    category has been soft-deleted or otherwise isn't available, rather
    than raising. Use _get_category_or_404 for write-path validation.
    """
    return (
        db.query(Category)
        .filter(
            Category.id == category_id,
            Category.user_id == user_id,
            Category.deleted_at.is_(None),
        )
        .first()
    )


# =============================================================================
# Endpoints
# =============================================================================


@router.post("", status_code=status.HTTP_201_CREATED, response_model=BudgetResponse)
def create_budget(
    data: BudgetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Create a new budget for a category/year. Returns 409 if one already exists."""
    # Validate category belongs to this user and is not soft-deleted.
    # We re-use the category object when building the response to denormalise
    # parent_category_id without a second lookup.
    category = _get_category_or_404(data.category_id, current_user.id, db)

    # Check for duplicate (user + category + year) before inserting
    existing = (
        db.query(Budget)
        .filter(
            Budget.user_id == current_user.id,
            Budget.category_id == data.category_id,
            Budget.year == data.year,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A budget already exists for this category and year",
        )

    budget = Budget(
        user_id=current_user.id,
        category_id=data.category_id,
        year=data.year,
        default_amount=data.default_amount,
        currency=data.currency,
        group=data.group,
        notes=data.notes,
    )
    db.add(budget)
    db.commit()
    db.refresh(budget)
    return _build_budget_response(budget, category)


@router.post("/copy-year", response_model=BudgetCopyYearResult)
def copy_year(
    data: BudgetCopyYear,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Copy every budget in from_year into to_year — the year-end rollover.

    Copies default_amount, currency, group and notes; overrides only when
    include_overrides is set. Safe to run repeatedly: a category that
    already has a to_year budget is skipped (its existing amount wins), as
    is a budget whose category has been soft-deleted.
    """
    source_query = db.query(Budget).filter(
        Budget.user_id == current_user.id, Budget.year == data.from_year,
    )
    if data.include_overrides:
        source_query = source_query.options(selectinload(Budget.overrides))
    source_budgets = source_query.all()

    # Two set lookups instead of a query per budget.
    already_budgeted = {
        category_id
        for (category_id,) in db.query(Budget.category_id).filter(
            Budget.user_id == current_user.id, Budget.year == data.to_year,
        )
    }
    live_category_ids = {
        category_id
        for (category_id,) in db.query(Category.id).filter(
            Category.user_id == current_user.id, Category.deleted_at.is_(None),
        )
    }

    created = 0
    for source in source_budgets:
        if source.category_id in already_budgeted or source.category_id not in live_category_ids:
            continue
        copy = Budget(
            user_id=current_user.id,
            category_id=source.category_id,
            year=data.to_year,
            default_amount=source.default_amount,
            currency=source.currency,
            group=source.group,
            notes=source.notes,
        )
        if data.include_overrides:
            copy.overrides = [
                BudgetOverride(month=o.month, amount=o.amount) for o in source.overrides
            ]
        db.add(copy)
        created += 1

    # A concurrent copy (another tab) can insert the same category/year
    # between our already_budgeted check and this commit. All-or-nothing:
    # roll back and let the client retry, which will then skip those rows.
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Budgets changed while copying. Please try again.",
        )
    return {"created": created, "skipped": len(source_budgets) - created}


@router.get("", response_model=list[BudgetResponse])
def list_budgets(
    year: Optional[int] = Query(default=None),
    group: Optional[str] = Query(default=None, min_length=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    """List all budgets for the current user. Optional ?year= and ?group= filters."""
    query = (
        db.query(Budget)
        .options(selectinload(Budget.overrides))
        .filter(Budget.user_id == current_user.id)
    )
    if year is not None:
        query = query.filter(Budget.year == year)
    if group is not None:
        query = query.filter(Budget.group == group)
    budgets = query.order_by(Budget.year, Budget.created_at).all()

    # Batch-fetch referenced categories in a single query to avoid N+1 —
    # same pattern as list_schedules in schedules.py.
    category_ids = {b.category_id for b in budgets}
    cat_map: dict = {}
    if category_ids:
        cat_list = (
            db.query(Category)
            .filter(
                Category.id.in_(category_ids),
                Category.user_id == current_user.id,
                Category.deleted_at.is_(None),
            )
            .all()
        )
        cat_map = {c.id: c for c in cat_list}

    return [_build_budget_response(b, cat_map.get(b.category_id)) for b in budgets]


@router.get("/{budget_id}", response_model=BudgetResponse)
def get_budget(
    budget_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Get a single budget with its monthly overrides."""
    budget = _get_budget_or_404(budget_id, current_user.id, db)
    category = _lookup_category(budget.category_id, current_user.id, db)
    return _build_budget_response(budget, category)


@router.put("/{budget_id}", response_model=BudgetResponse)
def update_budget(
    budget_id: uuid.UUID,
    data: BudgetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Update a budget's default_amount and/or currency."""
    budget = _get_budget_or_404(budget_id, current_user.id, db)

    # exclude_unset=True means only fields the client actually sent are included.
    # This distinguishes "not sent" from "sent as null".
    # default_amount and currency are NOT NULL in the DB — reject null for those.
    # group IS nullable — sending null clears the group (allowed).
    non_nullable_fields = {"default_amount", "currency"}
    updates = data.model_dump(exclude_unset=True)
    for field, value in updates.items():
        if value is None and field in non_nullable_fields:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"{field} cannot be null",
            )
        setattr(budget, field, value)

    db.commit()
    db.refresh(budget)
    category = _lookup_category(budget.category_id, current_user.id, db)
    return _build_budget_response(budget, category)


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
) -> dict:
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
    category = _lookup_category(budget.category_id, current_user.id, db)
    return _build_budget_response(budget, category)


@router.post(
    "/{budget_id}/overrides/batch",
    response_model=BudgetResponse,
)
def batch_overrides(
    budget_id: uuid.UUID,
    data: BudgetOverrideBatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Batch upsert/delete month overrides in a single transaction.

    Each item in data.overrides:
      - amount provided → upsert that month's override
      - amount is null  → delete that month's override (if it exists)

    Returns the full budget (with all overrides) so the client sees the
    updated state without a second GET. Eliminates the N+1 pattern of
    calling POST /overrides 12 times for "Apply to all months".
    """
    budget = _get_budget_or_404(budget_id, current_user.id, db)

    # Batch-load all existing overrides for the requested months in a single
    # query — avoids N individual SELECTs inside the loop.
    months = {item.month for item in data.overrides}
    existing_by_month = {
        o.month: o for o in db.query(BudgetOverride).filter(
            BudgetOverride.budget_id == budget.id,
            BudgetOverride.month.in_(months),
        ).all()
    }

    for item in data.overrides:
        existing = existing_by_month.get(item.month)
        if item.amount is not None:
            # Upsert
            if existing:
                existing.amount = item.amount
            else:
                db.add(BudgetOverride(
                    budget_id=budget.id,
                    month=item.month,
                    amount=item.amount,
                ))
        else:
            # Delete
            if existing:
                db.delete(existing)

    db.commit()
    db.refresh(budget)
    category = _lookup_category(budget.category_id, current_user.id, db)
    return _build_budget_response(budget, category)


@router.delete(
    "/{budget_id}/overrides/{month}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_override(
    budget_id: uuid.UUID,
    month: int = Path(..., ge=1, le=12),
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
