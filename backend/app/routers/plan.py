# app/routers/plan.py
#
# Purpose: HTTP endpoints for the Plan views.
#
# Endpoints:
#   GET /api/v1/plan/{year}/{month} → MonthlyPlan (200)
#   GET /api/v1/plan/{year}         → AnnualPlan  (200)
#
# The monthly endpoint is the primary view of Tidal — the "living spreadsheet"
# that shows planned vs actual vs remaining vs pending for every category in a month.
#
# The annual endpoint calls the monthly service 12 times (once per month) and
# returns all results as a single AnnualPlan. This avoids duplicating recurrence
# logic — the same service that powers the monthly view powers the annual view.
#
# Route ordering: /{year}/{month} is defined first so FastAPI matches the
# more-specific two-segment path before the one-segment /{year} path.
# In practice FastAPI matches by path segment count so there is no ambiguity,
# but declaring the specific route first is conventional best practice.

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.schemas.plan import AnnualPlan, MonthlyPlan
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


@router.get(
    "/{year}",
    response_model=AnnualPlan,
)
def get_annual_plan(
    year: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AnnualPlan:
    """
    Returns the annual plan for all 12 months of the given year.

    Calls get_monthly_plan once per month (January–December) and returns
    the results wrapped in an AnnualPlan. Reuses the same recurrence engine
    and budget logic as the monthly endpoint — no duplicated business logic.

    This powers the Annual Budget View: a spreadsheet-style table showing
    planned amounts per category across every month of the year.
    """
    months = [
        get_monthly_plan(year=year, month=m, user_id=current_user.id, db=db)
        for m in range(1, 13)
    ]
    return AnnualPlan(year=year, months=months)
