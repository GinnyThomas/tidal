# app/routers/plan.py
#
# Purpose: HTTP endpoint for the Monthly Plan View.
#
# Endpoints:
#   GET /api/v1/plan/{year}/{month} → MonthlyPlan (200)
#
# This endpoint is the primary view of Tidal — the "living spreadsheet" that
# shows planned vs actual vs remaining vs pending for every category in a month.
#
# It delegates all business logic to app/services/plan.py. The router's only
# job is to validate inputs, inject dependencies, call the service, and return.
#
# Path parameter validation:
#   FastAPI validates that year and month are integers. We add a manual check
#   that month is 1–12 because a path like /api/v1/plan/2026/13 is syntactically
#   valid (it's still an int) but semantically nonsensical.

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.schemas.plan import MonthlyPlan
from app.services.auth import get_current_user
from app.services.plan import get_monthly_plan


router = APIRouter(
    prefix="/api/v1/plan",
    tags=["plan"],
)


@router.get(
    "/{year}/{month}",
    response_model=MonthlyPlan,
)
def get_plan(
    year: int,
    month: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MonthlyPlan:
    """
    Returns the monthly plan view for the given year and month.

    The response includes:
      - rows: one PlanRow per category that has any planned, actual, or pending
        amount in this month. Categories with no activity are omitted.
      - total_*: aggregate sums across all rows.

    planned amounts come from active schedules whose recurrence pattern fires
    in this month. actual and pending come from the user's transactions dated
    within this month.
    """
    if not (1 <= month <= 12):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="month must be between 1 and 12.",
        )

    return get_monthly_plan(year=year, month=month, user_id=current_user.id, db=db)
