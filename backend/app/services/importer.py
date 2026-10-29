# app/services/importer.py
#
# Purpose: Create transactions from bank-signed rows, skipping duplicates.
#
# Shared by two callers so both get identical dedup behaviour:
#   - POST /api/v1/transactions/import  (CSV import, rows from the frontend)
#   - POST /api/v1/bank-feeds/links/{id}/sync  (rows from a bank feed)
#
# A CSV import and a bank feed of the same month therefore never double up:
# the feed's transaction id lands in external_id, and the hash catches rows
# that were entered by hand or imported from a CSV without an id.

import uuid
from datetime import date as date_
from decimal import Decimal
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.account import Account
from app.models.transaction import Transaction
from app.services.dedup import compute_dedup_hash


@dataclass(frozen=True)
class ImportRow:
    """One transaction to import. amount is bank-signed: negative = money out."""

    date: date_
    amount: Decimal
    payee: str
    notes: str | None = None
    external_id: str | None = None
    category_id: uuid.UUID | None = None


def import_rows(
    db: Session,
    user_id: uuid.UUID,
    account: Account,
    rows: list[ImportRow],
) -> dict:
    """
    Creates a transaction per row, skipping duplicates, in one DB transaction.

    Dedup (server-side safety net):
      - If external_id is present and matches an existing transaction on the
        same account, the row is skipped.
      - Otherwise, if the computed dedup_hash matches an existing transaction
        on the same account, the row is skipped.

    Currency is always taken from the account. All rows become status='cleared'.
    Returns {"created", "skipped_duplicates", "skipped_rows"}.
    """
    # Fetch existing external_ids and hashes for this account in one query each.
    existing_external_ids: set[str] = {
        row[0] for row in db.query(Transaction.external_id).filter(
            Transaction.account_id == account.id,
            Transaction.external_id.isnot(None),
            Transaction.deleted_at.is_(None),
        ).all()
    }
    existing_hashes: set[str] = {
        row[0] for row in db.query(Transaction.dedup_hash).filter(
            Transaction.account_id == account.id,
            Transaction.dedup_hash.isnot(None),
            Transaction.deleted_at.is_(None),
        ).all()
    }

    created = 0
    skipped = 0
    skipped_rows: list[dict] = []
    new_transactions: list[Transaction] = []

    for i, row in enumerate(rows):
        # external_id dedup takes precedence
        if row.external_id and row.external_id in existing_external_ids:
            skipped += 1
            skipped_rows.append({"row_index": i, "reason": f"Duplicate external_id: {row.external_id}"})
            continue

        # Banks use a signed amount (negative = debit, positive = credit).
        # `amount` must always be a positive magnitude — direction is derived
        # from transaction_type (and account_type for credit cards) elsewhere,
        # e.g. _calculate_balance() in routers/accounts.py. Hash on the same
        # magnitude used for storage so this matches the dedup hash computed
        # for manually-entered transactions (also a positive magnitude).
        amount = abs(row.amount)

        h = compute_dedup_hash(
            account_id=account.id,
            date_=row.date,
            amount=amount,
            payee=row.payee,
        )
        if h in existing_hashes:
            skipped += 1
            skipped_rows.append({"row_index": i, "reason": "Duplicate transaction (hash match)"})
            continue

        new_transactions.append(Transaction(
            user_id=user_id,
            account_id=account.id,
            category_id=row.category_id,
            date=row.date,
            amount=amount,
            currency=account.currency,
            # TODO(refunds): banks give no refund signal — all positive
            # amounts become 'income'. Revisit as part of the refunds refactor.
            transaction_type="income" if row.amount > 0 else "expense",
            status="cleared",
            payee=row.payee,
            note=row.notes,
            external_id=row.external_id,
            dedup_hash=h,
        ))
        # Track within-batch dedup so duplicate rows in the same batch are
        # also skipped.
        existing_hashes.add(h)
        if row.external_id:
            existing_external_ids.add(row.external_id)
        created += 1

    if new_transactions:
        db.add_all(new_transactions)
        try:
            db.commit()
        except Exception:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Import failed due to a database error. No transactions were created.",
            )

    return {"created": created, "skipped_duplicates": skipped, "skipped_rows": skipped_rows}
