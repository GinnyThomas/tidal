# app/routers/schedules.py
#
# Purpose: HTTP endpoints for managing schedules.
#
# Endpoints:
#   POST   /api/v1/schedules                      → create schedule (201)
#   GET    /api/v1/schedules                      → list schedules (200)
#   GET    /api/v1/schedules/{id}                 → get single schedule (200 or 404)
#   PUT    /api/v1/schedules/{id}                 → update schedule (200 or 404)
#   DELETE /api/v1/schedules/{id}                 → soft-delete schedule (204 or 404)
#   PATCH  /api/v1/schedules/{id}/toggle-active   → flip active flag (200 or 404)
#
# Query parameters for GET /api/v1/schedules:
#   include_inactive — if true, include inactive (active=False) schedules.
#                      Default: false (only active schedules shown).
#
# Route ordering note:
#   No special ordering is required between GET /{id} and
#   PATCH /{id}/toggle-active because the latter is a more specific
#   multi-segment path and won't be confused with the single-segment {id} route.
#
# Security model:
#   All endpoints require a valid JWT via Depends(get_current_user).
#   Every query scopes to current_user.id. Account and category ownership
#   are validated on create/update (prevents cross-user injection by guessing UUIDs).

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.account import Account
from app.models.category import Category
from app.models.schedule import Schedule
from app.models.user import User
from app.schemas.schedule import (
    ScheduleCreate,
    ScheduleResponse,
    ScheduleUpdate,
)
from app.services.auth import get_current_user
from app.services.plan import get_next_occurrence


router = APIRouter(
    prefix="/api/v1/schedules",
    tags=["schedules"],
)


# =============================================================================
# Helpers
# =============================================================================


def _get_schedule_or_404(
    schedule_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session,
) -> Schedule:
    """
    Fetch a non-deleted schedule by ID scoped to the given user.
    Raises 404 if not found, soft-deleted, or belongs to another user.

    Same 404-instead-of-403 pattern as accounts and transactions: we do not
    confirm whether a resource exists for a different user.
    """
    schedule = (
        db.query(Schedule)
        .filter(
            Schedule.id == schedule_id,
            Schedule.user_id == user_id,
            Schedule.deleted_at.is_(None),
        )
        .first()
    )
    if schedule is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Schedule not found.",
        )
    return schedule


def _get_account_or_404(
    account_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session,
) -> Account:
    """Validate that an account exists and belongs to the current user."""
    account = (
        db.query(Account)
        .filter(
            Account.id == account_id,
            Account.user_id == user_id,
            Account.deleted_at.is_(None),
        )
        .first()
    )
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found.",
        )
    return account


def _get_category_or_404(
    category_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session,
) -> Category:
    """Validate that a category exists and belongs to the current user."""
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


def _build_sched_response(sched: Schedule, category: Category | None) -> dict:
    """
    Build a dict matching ScheduleResponse, adding category_name and
    category_icon from the related Category row.

    Same pattern as _build_tx_response in transactions.py — the new fields
    are not attributes on the Schedule ORM model, so we build a dict manually
    rather than returning the ORM object directly to Pydantic.
    """
    return {
        "id": sched.id,
        "user_id": sched.user_id,
        "account_id": sched.account_id,
        "category_id": sched.category_id,
        "schedule_type": sched.schedule_type,
        "from_account_id": sched.from_account_id,
        "to_account_id": sched.to_account_id,
        "name": sched.name,
        "payee": sched.payee,
        "amount": sched.amount,
        "currency": sched.currency,
        "frequency": sched.frequency,
        "interval": sched.interval,
        "day_of_month": sched.day_of_month,
        "start_date": sched.start_date,
        "end_date": sched.end_date,
        "auto_generate": sched.auto_generate,
        "active": sched.active,
        "group": sched.group,
        "note": sched.note,
        "created_at": sched.created_at,
        "next_occurrence": get_next_occurrence(sched),
        "category_name": category.name if category else None,
        "category_icon": category.icon if category else None,
        "category_is_income": category.is_income if category else False,
    }


# =============================================================================
# Endpoints
# =============================================================================


@router.post(
    "",
    response_model=ScheduleResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_schedule(
    schedule_in: ScheduleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Creates a new recurring schedule for the current user.

    Validates that account_id and category_id both belong to the current user
    before inserting — prevents cross-user injection by guessing UUIDs.
    """
    _get_account_or_404(schedule_in.account_id, current_user.id, db)

    # Cross-field validation based on schedule_type
    stype = schedule_in.schedule_type
    if stype == "transfer":
        if not schedule_in.from_account_id or not schedule_in.to_account_id:
            raise HTTPException(status_code=422, detail="Transfer schedules require from_account_id and to_account_id.")
        if schedule_in.from_account_id == schedule_in.to_account_id:
            raise HTTPException(status_code=422, detail="Transfer source and destination must be different accounts.")
        if schedule_in.category_id is not None:
            raise HTTPException(status_code=422, detail="Transfer schedules must not have a category_id.")
        # Validate transfer account ownership
        _get_account_or_404(schedule_in.from_account_id, current_user.id, db)
        _get_account_or_404(schedule_in.to_account_id, current_user.id, db)
    else:
        if schedule_in.category_id is None:
            raise HTTPException(status_code=422, detail="Regular schedules require a category_id.")
        if schedule_in.from_account_id or schedule_in.to_account_id:
            raise HTTPException(status_code=422, detail="Regular schedules must not have from_account_id or to_account_id.")

    # Category validation for regular schedules
    category = None
    if schedule_in.category_id is not None:
        category = _get_category_or_404(schedule_in.category_id, current_user.id, db)

    schedule = Schedule(
        user_id=current_user.id,
        account_id=schedule_in.account_id,
        category_id=schedule_in.category_id,
        schedule_type=stype.value if hasattr(stype, 'value') else stype,
        from_account_id=schedule_in.from_account_id,
        to_account_id=schedule_in.to_account_id,
        name=schedule_in.name,
        payee=schedule_in.payee,
        amount=schedule_in.amount,
        currency=schedule_in.currency,
        frequency=schedule_in.frequency.value,
        interval=schedule_in.interval,
        day_of_month=schedule_in.day_of_month,
        start_date=schedule_in.start_date,
        end_date=schedule_in.end_date,
        auto_generate=schedule_in.auto_generate,
        active=schedule_in.active,
        group=schedule_in.group,
        note=schedule_in.note,
    )
    db.add(schedule)
    db.commit()
    db.refresh(schedule)
    return _build_sched_response(schedule, category)


@router.get(
    "",
    response_model=list[ScheduleResponse],
)
def list_schedules(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    include_inactive: bool = Query(default=False),
) -> list[dict]:
    """
    Returns all non-deleted schedules for the current user.

    By default, inactive schedules (active=False) are excluded.
    Pass ?include_inactive=true to include them.

    Why exclude inactive by default?
    The list is primarily used to show "what is currently scheduled to happen".
    A paused schedule shouldn't appear alongside live ones by default.
    """
    query = db.query(Schedule).filter(
        Schedule.user_id == current_user.id,
        Schedule.deleted_at.is_(None),
    )

    if not include_inactive:
        # Only return schedules where active is True.
        # Uses .is_(True) — consistent with SQLAlchemy best practice for booleans.
        query = query.filter(Schedule.active.is_(True))

    schedules = query.all()

    # Batch-fetch all referenced categories in a single query to avoid N+1.
    category_ids = {s.category_id for s in schedules if s.category_id is not None}
    cat_map: dict = {}
    if category_ids:
        cat_list = db.query(Category).filter(Category.id.in_(category_ids)).all()
        cat_map = {c.id: c for c in cat_list}

    return [_build_sched_response(s, cat_map.get(s.category_id)) for s in schedules]


@router.get(
    "/{schedule_id}",
    response_model=ScheduleResponse,
)
def get_schedule(
    schedule_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Returns a single schedule by ID.

    Returns 404 if not found, soft-deleted, or belongs to another user.
    """
    sched = _get_schedule_or_404(schedule_id, current_user.id, db)
    category = db.query(Category).filter(Category.id == sched.category_id).first() if sched.category_id else None
    return _build_sched_response(sched, category)


@router.put(
    "/{schedule_id}",
    response_model=ScheduleResponse,
)
def update_schedule(
    schedule_id: uuid.UUID,
    schedule_in: ScheduleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Updates a schedule with the provided fields (partial update).

    Uses exclude_unset=True so only fields the client explicitly sent are
    changed — omitted fields keep their existing values.
    """
    schedule = _get_schedule_or_404(schedule_id, current_user.id, db)

    update_data = schedule_in.model_dump(exclude_unset=True)

    # Guard against explicitly nulling non-nullable fields.
    # exclude_unset=True omits missing fields, but the client can still
    # send {"amount": null} — reject that before writing to the database.
    # Determine effective schedule_type for validation
    effective_type = update_data.get("schedule_type", schedule.schedule_type)
    if hasattr(effective_type, 'value'):
        effective_type = effective_type.value

    # Guard against explicitly nulling non-nullable fields.
    # category_id is nullable for transfer schedules, so exclude it from
    # NON_NULLABLE when the schedule is a transfer type.
    NON_NULLABLE = {"name", "amount", "currency", "frequency", "interval",
                    "start_date", "account_id", "auto_generate", "active"}
    if effective_type != "transfer":
        NON_NULLABLE.add("category_id")
    for field in NON_NULLABLE:
        if field in update_data and update_data[field] is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"'{field}' cannot be null.",
            )

    # Validate ownership of any referenced foreign keys being changed
    if "account_id" in update_data and update_data["account_id"] is not None:
        _get_account_or_404(update_data["account_id"], current_user.id, db)

    if "category_id" in update_data and update_data["category_id"] is not None:
        _get_category_or_404(update_data["category_id"], current_user.id, db)

    if "from_account_id" in update_data and update_data["from_account_id"] is not None:
        _get_account_or_404(update_data["from_account_id"], current_user.id, db)

    if "to_account_id" in update_data and update_data["to_account_id"] is not None:
        _get_account_or_404(update_data["to_account_id"], current_user.id, db)

    # Enum fields need .value to store the plain string in the database
    for field, value in update_data.items():
        if field in ("frequency", "schedule_type") and value is not None and hasattr(value, 'value'):
            value = value.value
        setattr(schedule, field, value)

    db.commit()
    db.refresh(schedule)
    # Look up the (potentially updated) category for the response
    category = db.query(Category).filter(Category.id == schedule.category_id).first() if schedule.category_id else None
    return _build_sched_response(schedule, category)


@router.patch(
    "/{schedule_id}/toggle-active",
    response_model=ScheduleResponse,
)
def toggle_active(
    schedule_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Flips the active flag on a schedule.

    If the schedule is currently active, it becomes inactive (paused).
    If it is inactive, it becomes active again.

    Why a dedicated endpoint instead of PUT?
    Toggle is a common, well-understood UI action ("pause / resume").
    A dedicated PATCH endpoint makes the intent explicit and avoids clients
    needing to read the current value before sending an update.

    Note: defined BEFORE GET /{schedule_id} in the file so FastAPI sees the
    more specific path first and doesn't try to parse "toggle-active" as a UUID.
    """
    schedule = _get_schedule_or_404(schedule_id, current_user.id, db)
    schedule.active = not schedule.active
    db.commit()
    db.refresh(schedule)
    category = db.query(Category).filter(Category.id == schedule.category_id).first() if schedule.category_id else None
    return _build_sched_response(schedule, category)


@router.delete(
    "/{schedule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_schedule(
    schedule_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """
    Soft-deletes a schedule by setting deleted_at to the current UTC time.

    The row is preserved in the database for audit purposes. All queries
    filter WHERE deleted_at IS NULL, making this schedule invisible.

    Returns 204 No Content on success.
    """
    schedule = _get_schedule_or_404(schedule_id, current_user.id, db)
    schedule.deleted_at = datetime.now(timezone.utc)
    db.commit()
