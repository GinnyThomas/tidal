# app/routers/plan.py
#
# Purpose: HTTP endpoints for the Plan views.
#
# Endpoints:
#   GET /api/v1/plan/{year}/{month}?group= → MonthlyPlan (200)
#   GET /api/v1/plan/{year}?group=         → AnnualPlan  (200)
#
# The optional ?group= query param filters budgets by their group field.
# Schedules and transactions are NOT filtered — only budget contributions
# to planned totals are affected. This lets users view planned spending
# for a specific context (e.g. "UK" vs "España") without losing schedule
# and transaction visibility.

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
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
    group: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MonthlyPlan:
    """
    Returns the monthly plan view for the given year and month.

    Optional ?group= param filters budget contributions by group.
    Schedules and transactions are always included regardless of group.
    """
    if not (1 <= month <= 12):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="month must be between 1 and 12.",
        )

    return get_monthly_plan(
        year=year, month=month, user_id=current_user.id, db=db, group=group,
    )


@router.get(
    "/{year}",
    response_model=AnnualPlan,
)
def get_annual_plan(
    year: int,
    group: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AnnualPlan:
    """
    Returns the annual plan for all 12 months of the given year.

    Optional ?group= param filters budget contributions by group.
    """
    months = [
        get_monthly_plan(
            year=year, month=m, user_id=current_user.id, db=db, group=group,
        )
        for m in range(1, 13)
    ]
    return AnnualPlan(year=year, months=months)
