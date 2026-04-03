# app/services/plan.py
#
# Purpose: Business logic for the Monthly Plan View.
#
# The central function is get_monthly_plan(), which assembles three streams
# of data for a given month:
#
#   planned  — what schedules said would happen (recurrence rules applied)
#   actual   — what cleared/reconciled transactions show actually happened
#   pending  — what is expected but not yet settled
#
# These are grouped by category and returned as a list of PlanRow objects.
#
# --- Recurrence logic ---
#
# _count_occurrences_in_month(schedule, year, month) is the core.
# It answers: "how many times does this schedule fire in this month?"
# The result multiplied by the schedule's amount gives the planned contribution.
#
# Frequency rules:
#
#   monthly      — fires once per `interval` months on `day_of_month` (or
#                  start_date's day). Months since start must be divisible
#                  by interval.
#
#   annually     — fires once per year in the same month as start_date.
#
#   quarterly    — fires every 3 months from start_date.
#
#   weekly       — fires every (7 * interval) days from start_date. We count
#                  how many such dates fall within the target month's window.
#
#   every_n_days — fires every `interval` days from start_date. Same counting
#                  approach as weekly.
#
#   daily        — fires every day (equivalent to every_n_days with interval=1).
#
# For weekly/every_n_days/daily we use arithmetic (not a loop) to jump from
# start_date directly to the first occurrence in the month, then count by
# integer division. This keeps the computation O(1) even for old schedules.

import calendar
import uuid
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.category import Category
from app.models.schedule import Schedule
from app.models.transaction import Transaction
from app.schemas.plan import MonthlyPlan, PlanRow


# =============================================================================
# Recurrence helper
# =============================================================================


def _count_occurrences_in_month(schedule: Schedule, year: int, month: int) -> int:
    """
    Returns how many times a schedule fires in the given year/month.

    Returns 0 if the schedule hasn't started, has already ended, or its
    recurrence pattern simply doesn't land in this month.
    """
    first_day = date(year, month, 1)
    last_day = date(year, month, calendar.monthrange(year, month)[1])

    # Schedule hasn't started yet
    if schedule.start_date > last_day:
        return 0

    # Schedule ended before this month started
    if schedule.end_date is not None and schedule.end_date < first_day:
        return 0

    freq = schedule.frequency
    interval = schedule.interval or 1  # guard against None (shouldn't happen but be safe)

    # ------------------------------------------------------------------
    # monthly: fires on day_of_month (or start_date.day) once every
    # `interval` months from start_date.
    # ------------------------------------------------------------------
    if freq == "monthly":
        months_since_start = (
            (year - schedule.start_date.year) * 12
            + (month - schedule.start_date.month)
        )
        if months_since_start < 0:
            return 0
        if months_since_start % interval != 0:
            return 0
        fire_day = schedule.day_of_month or schedule.start_date.day
        # Clamp to the last day of the month (e.g. day_of_month=31 in February → 28/29)
        fire_day = min(fire_day, calendar.monthrange(year, month)[1])
        fire_date = date(year, month, fire_day)
        if schedule.start_date <= fire_date and (
            schedule.end_date is None or fire_date <= schedule.end_date
        ):
            return 1
        return 0

    # ------------------------------------------------------------------
    # annually: fires in the same calendar month as start_date, once per year.
    # ------------------------------------------------------------------
    if freq == "annually":
        if schedule.start_date.month != month:
            return 0
        fire_day = schedule.day_of_month or schedule.start_date.day
        fire_day = min(fire_day, calendar.monthrange(year, month)[1])
        fire_date = date(year, month, fire_day)
        if schedule.start_date <= fire_date and (
            schedule.end_date is None or fire_date <= schedule.end_date
        ):
            return 1
        return 0

    # ------------------------------------------------------------------
    # quarterly: fires every 3 months from start_date.
    # ------------------------------------------------------------------
    if freq == "quarterly":
        months_since_start = (
            (year - schedule.start_date.year) * 12
            + (month - schedule.start_date.month)
        )
        if months_since_start < 0:
            return 0
        if months_since_start % 3 != 0:
            return 0
        fire_day = schedule.day_of_month or schedule.start_date.day
        fire_day = min(fire_day, calendar.monthrange(year, month)[1])
        fire_date = date(year, month, fire_day)
        if schedule.start_date <= fire_date and (
            schedule.end_date is None or fire_date <= schedule.end_date
        ):
            return 1
        return 0

    # ------------------------------------------------------------------
    # weekly / every_n_days / daily — step-based recurrences.
    #
    # Strategy (O(1), not a loop):
    #   1. Compute the step size in days.
    #   2. Jump from start_date to the first occurrence >= first_day of month.
    #   3. If that first occurrence is beyond last_day, return 0.
    #   4. Otherwise count how many step-sized intervals fit between the
    #      first occurrence and the effective end (min of last_day and end_date).
    # ------------------------------------------------------------------
    if freq in ("daily", "weekly", "every_n_days"):
        if freq == "weekly":
            step = 7 * interval
        elif freq == "every_n_days":
            step = interval
        else:  # daily
            step = 1

        # Find the first occurrence on or after first_day
        if schedule.start_date >= first_day:
            first_occurrence = schedule.start_date
        else:
            days_since_start = (first_day - schedule.start_date).days
            # How many full steps do we need to jump to reach or pass first_day?
            steps_needed = (days_since_start + step - 1) // step  # ceiling division
            first_occurrence = schedule.start_date + timedelta(days=steps_needed * step)

        if first_occurrence > last_day:
            return 0

        # The effective window end is the earlier of last_day and end_date
        effective_end = last_day
        if schedule.end_date is not None:
            effective_end = min(effective_end, schedule.end_date)

        if first_occurrence > effective_end:
            return 0

        # Count: how many occurrences fit from first_occurrence to effective_end?
        days_in_range = (effective_end - first_occurrence).days
        return days_in_range // step + 1

    # Unknown frequency — return 0 (safe default)
    return 0


# =============================================================================
# Main plan assembly function
# =============================================================================


def get_monthly_plan(year: int, month: int, user_id: uuid.UUID, db: Session) -> MonthlyPlan:
    """
    Assembles the full monthly plan for a given user and month.

    Steps:
      1. Load all active, non-deleted schedules for the user.
      2. For each schedule, count occurrences in the target month and accumulate
         planned amounts by category.
      3. Load all non-deleted transactions for the user in the target month.
      4. Separate into actual (cleared/reconciled) and pending buckets,
         accumulating by category.
      5. Collect all category IDs that have any non-zero amount.
      6. Load category metadata (name, parent) for those IDs.
      7. Build PlanRow objects sorted by category name.
      8. Compute totals across all rows.
      9. Return MonthlyPlan.
    """
    first_day = date(year, month, 1)
    last_day = date(year, month, calendar.monthrange(year, month)[1])

    # --- Step 1: Schedules ---
    schedules = (
        db.query(Schedule)
        .filter(
            Schedule.user_id == user_id,
            Schedule.deleted_at.is_(None),
            Schedule.active.is_(True),
        )
        .all()
    )

    # --- Step 2: Planned amounts by category ---
    planned_by_category: dict[uuid.UUID, Decimal] = {}
    for schedule in schedules:
        count = _count_occurrences_in_month(schedule, year, month)
        if count > 0:
            cat_id = schedule.category_id
            planned_by_category[cat_id] = (
                planned_by_category.get(cat_id, Decimal("0")) + schedule.amount * count
            )

    # --- Step 3: Transactions in the target month ---
    transactions = (
        db.query(Transaction)
        .filter(
            Transaction.user_id == user_id,
            Transaction.deleted_at.is_(None),
            Transaction.date >= first_day,
            Transaction.date <= last_day,
        )
        .all()
    )

    # --- Step 4: Actual and pending by category ---
    actual_by_category: dict[uuid.UUID, Decimal] = {}
    pending_by_category: dict[uuid.UUID, Decimal] = {}

    for txn in transactions:
        cat_id = txn.category_id
        if txn.status in ("cleared", "reconciled"):
            actual_by_category[cat_id] = (
                actual_by_category.get(cat_id, Decimal("0")) + txn.amount
            )
        elif txn.status == "pending":
            pending_by_category[cat_id] = (
                pending_by_category.get(cat_id, Decimal("0")) + txn.amount
            )

    # --- Step 5: Union of all category IDs with any activity ---
    all_category_ids = (
        set(planned_by_category.keys())
        | set(actual_by_category.keys())
        | set(pending_by_category.keys())
    )

    if not all_category_ids:
        return MonthlyPlan(
            year=year,
            month=month,
            rows=[],
            total_planned=Decimal("0"),
            total_actual=Decimal("0"),
            total_remaining=Decimal("0"),
            total_pending=Decimal("0"),
        )

    # --- Step 6: Load category metadata ---
    # Scoped to the current user and non-deleted only.
    # Without user_id scoping, a category ID collision across users (impossible
    # with UUIDs but defensive coding) could leak another user's category name.
    categories = (
        db.query(Category)
        .filter(
            Category.id.in_(list(all_category_ids)),
            Category.user_id == user_id,
            Category.deleted_at.is_(None),
        )
        .all()
    )
    category_map: dict[uuid.UUID, Category] = {c.id: c for c in categories}

    # --- Step 7: Build PlanRow objects, sorted by category name ---
    rows: list[PlanRow] = []
    for cat_id in sorted(all_category_ids, key=lambda cid: category_map[cid].name if cid in category_map else ""):
        cat = category_map.get(cat_id)
        if cat is None:
            # Category was deleted — skip rather than error
            continue

        planned = planned_by_category.get(cat_id, Decimal("0"))
        actual = actual_by_category.get(cat_id, Decimal("0"))
        pending = pending_by_category.get(cat_id, Decimal("0"))
        remaining = planned - actual

        rows.append(
            PlanRow(
                category_id=cat_id,
                category_name=cat.name,
                parent_category_id=cat.parent_category_id,
                planned=planned,
                actual=actual,
                remaining=remaining,
                pending=pending,
            )
        )

    # --- Step 8: Aggregate totals ---
    total_planned = sum((r.planned for r in rows), Decimal("0"))
    total_actual = sum((r.actual for r in rows), Decimal("0"))
    total_remaining = sum((r.remaining for r in rows), Decimal("0"))
    total_pending = sum((r.pending for r in rows), Decimal("0"))

    return MonthlyPlan(
        year=year,
        month=month,
        rows=rows,
        total_planned=total_planned,
        total_actual=total_actual,
        total_remaining=total_remaining,
        total_pending=total_pending,
    )
