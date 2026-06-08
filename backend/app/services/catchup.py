# app/services/catchup.py
#
# Purpose: Auto-create transactions from schedules that have overdue occurrences.
#
# Called on app load via POST /api/v1/schedules/catch-up. Processes all active
# schedules for the user that have a next occurrence on or before `today`,
# creating pending transactions for each missed period and advancing the
# schedule's virtual next_occurrence forward.

import uuid
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.models.category import Category
from app.models.schedule import Schedule
from app.models.transaction import Transaction
from app.services.plan import get_next_occurrence


def catch_up_schedules(
    db: Session,
    user_id: uuid.UUID,
    today: date,
) -> list[Transaction]:
    """
    Process all active schedules with overdue occurrences, creating pending
    transactions for each. Returns the list of created transactions.

    All changes are made within the caller's DB session — commit/rollback
    is the caller's responsibility.
    """
    schedules = (
        db.query(Schedule)
        .filter(
            Schedule.user_id == user_id,
            Schedule.active.is_(True),
            Schedule.deleted_at.is_(None),
        )
        .all()
    )

    # Load income categories for tx_type determination
    income_cat_ids: set[uuid.UUID] = set()
    cat_ids = {s.category_id for s in schedules if s.category_id is not None}
    if cat_ids:
        income_cats = (
            db.query(Category.id)
            .filter(Category.id.in_(cat_ids), Category.is_income.is_(True))
            .all()
        )
        income_cat_ids = {row[0] for row in income_cats}

    # Find the latest existing transaction date per schedule to avoid duplicates
    from sqlalchemy import func as sa_func
    latest_tx_dates: dict[uuid.UUID, date] = {}
    sched_ids = [s.id for s in schedules]
    if sched_ids:
        rows = (
            db.query(Transaction.schedule_id, sa_func.max(Transaction.date))
            .filter(
                Transaction.schedule_id.in_(sched_ids),
                Transaction.user_id == user_id,
                Transaction.deleted_at.is_(None),
            )
            .group_by(Transaction.schedule_id)
            .all()
        )
        latest_tx_dates = {row[0]: row[1] for row in rows}

    created: list[Transaction] = []

    for sched in schedules:
        # Start from after the latest existing transaction for this schedule,
        # or from the schedule's start_date if no transactions exist yet.
        latest = latest_tx_dates.get(sched.id)
        if latest is not None:
            ref = latest + timedelta(days=1)
        else:
            ref = sched.start_date
        next_occ = get_next_occurrence(sched, reference_date=ref)

        # Create transactions for each occurrence up to and including today
        while next_occ is not None and next_occ <= today:
            if sched.schedule_type == "transfer" and sched.from_account_id and sched.to_account_id:
                debit_id = uuid.uuid4()
                debit = Transaction(
                    id=debit_id,
                    user_id=user_id,
                    account_id=sched.from_account_id,
                    category_id=None,
                    schedule_id=sched.id,
                    date=next_occ,
                    amount=sched.amount,
                    currency=sched.currency,
                    transaction_type="transfer",
                    status="pending",
                    payee=sched.payee,
                    note=sched.note,
                )
                credit = Transaction(
                    user_id=user_id,
                    account_id=sched.to_account_id,
                    category_id=None,
                    schedule_id=sched.id,
                    date=next_occ,
                    amount=sched.amount,
                    currency=sched.currency,
                    transaction_type="transfer",
                    status="pending",
                    payee=sched.payee,
                    note=sched.note,
                    parent_transaction_id=debit_id,
                )
                db.add_all([debit, credit])
                created.extend([debit, credit])
            else:
                tx_type = "income" if sched.category_id in income_cat_ids else "expense"
                tx = Transaction(
                    user_id=user_id,
                    account_id=sched.account_id,
                    category_id=sched.category_id,
                    schedule_id=sched.id,
                    date=next_occ,
                    amount=sched.amount,
                    currency=sched.currency,
                    transaction_type=tx_type,
                    status="pending",
                    payee=sched.payee,
                    note=sched.note,
                )
                db.add(tx)
                created.append(tx)

            # Advance to the next occurrence after this one
            next_occ = get_next_occurrence(sched, reference_date=next_occ + timedelta(days=1))

    return created
