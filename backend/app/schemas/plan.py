# app/schemas/plan.py
#
# Purpose: Pydantic v2 schemas for the Monthly Plan View response.
#
# Schemas:
#   PlanRow     — one category's planned/actual/remaining/pending for a month
#   MonthlyPlan — the full response: year, month, rows, and aggregate totals
#
# Why are amounts stored as Decimal internally but serialised as strings?
#   JavaScript's IEEE 754 doubles cannot represent all decimal fractions
#   exactly (e.g. 0.1 + 0.2 ≠ 0.3). Sending amounts as strings prevents the
#   client-side from silently rounding financial figures. Same pattern as
#   Transaction and Schedule schemas.
#
# Why is PlanRow not a SQLAlchemy model?
#   The plan view aggregates data across schedules, transactions, and categories
#   — it is a computed result, not a single table row. Pydantic-only schemas
#   (no model_config = ConfigDict(from_attributes=True)) are appropriate here
#   because we build these objects manually in the service layer.

import uuid
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field, field_serializer

from app.schemas.opening_balance import OpeningBalanceResponse


class ScheduleRow(BaseModel):
    """
    One schedule's planned contribution within a PlanRow.

    Shows the individual schedule name and how much it contributes to the
    category's planned total for the month. This powers the expand/collapse
    feature in the Monthly Plan View — users can drill into a category to
    see which schedules make up its planned amount.
    """

    schedule_id: uuid.UUID
    schedule_name: str
    planned: Decimal

    @field_serializer("planned")
    def serialize_amount(self, value: Decimal) -> str:
        """Return amount as a string with exactly 2 decimal places."""
        return str(value.quantize(Decimal("0.01")))


class PlanRow(BaseModel):
    """
    One category's financial picture for a month.

    planned   — total of scheduled amounts that fall in this month.
    actual    — sum of cleared + reconciled transaction amounts.
    remaining — planned minus actual (can be negative if overspent).
    pending   — sum of pending transaction amounts (expected but not settled).
    schedules — individual schedule breakdowns that make up the planned total.

    pending is shown separately because pending transactions intentionally do
    not count toward actual spend — they might never settle. Surfacing them
    separately lets the user see what is coming without letting it corrupt
    the view of what has already happened.
    """

    category_id: uuid.UUID
    category_name: str
    parent_category_id: Optional[uuid.UUID]
    planned: Decimal
    actual: Decimal
    remaining: Decimal
    pending: Decimal
    schedules: list[ScheduleRow] = Field(default_factory=list)
    # Budget group for this category (e.g. "UK", "España").
    # None if the category has no budget or the budget has no group.
    # Used by the frontend to display group section headers.
    group: Optional[str] = None
    # True if the category represents income (salary, freelance, etc.)
    is_income: bool = False

    @field_serializer("planned", "actual", "remaining", "pending")
    def serialize_amount(self, value: Decimal) -> str:
        """Return amount as a string with exactly 2 decimal places."""
        return str(value.quantize(Decimal("0.01")))


class MonthlyPlan(BaseModel):
    """
    Full response from GET /api/v1/plan/{year}/{month}.

    rows          — one PlanRow per category that has any activity this month.
    total_*       — sum of each column across all rows (for a footer/summary row).

    Categories with no planned amount, no actual spend, and no pending
    transactions are omitted from rows entirely — they have nothing meaningful
    to show.
    """

    year: int
    month: int
    rows: list[PlanRow]
    total_planned: Decimal
    total_actual: Decimal
    total_remaining: Decimal
    total_pending: Decimal

    @field_serializer("total_planned", "total_actual", "total_remaining", "total_pending")
    def serialize_total(self, value: Decimal) -> str:
        """Return total as a string with exactly 2 decimal places."""
        return str(value.quantize(Decimal("0.01")))


class AnnualPlan(BaseModel):
    """
    Full response from GET /api/v1/plan/{year}.

    year              — the calendar year.
    months            — one MonthlyPlan per month, January through December.
    opening_balances  — group opening balances for the year (for cash flow view).
    """

    year: int
    months: list[MonthlyPlan]
    opening_balances: list[OpeningBalanceResponse] = Field(default_factory=list)
