# app/services/dedup.py
#
# Purpose: Compute the SHA-256 dedup hash for a transaction.
#
# The hash is the same whether a transaction was created manually or via CSV
# import — that's the key property that lets the import detect duplicates of
# hand-entered transactions and vice versa.
#
# Hash input: f"{account_id}|{date_iso}|{amount_str}|{payee_normalized}"
#   - account_id: UUID as string (no braces)
#   - date_iso: YYYY-MM-DD
#   - amount_str: fixed 2 decimal places, e.g. "12.34" or "-12.34"
#   - payee_normalized: lowercase, leading/trailing whitespace stripped,
#     internal multiple spaces collapsed to single space
#
# The amount is formatted with exactly 2 decimal places to avoid any
# float representation ambiguity before hashing.

import hashlib
import re
import uuid
from datetime import date
from decimal import Decimal


def _normalize_payee(payee: str | None) -> str:
    """Lowercase, strip, collapse internal spaces."""
    if not payee:
        return ""
    return re.sub(r"\s+", " ", payee.strip().lower())


def compute_dedup_hash(
    account_id: uuid.UUID,
    date_: date,
    amount: Decimal,
    payee: str | None,
) -> str:
    """Return the SHA-256 hex digest used for dedup matching.

    Called identically from both the manual-create endpoint and the import
    endpoint so that manually entered transactions can be detected as
    duplicates on a subsequent import of the same data.

    Hash format: "{account_id}|{date_iso}|{amount_str}|{payee_normalized}"
      - account_id: UUID as string (no braces)
      - date_iso: YYYY-MM-DD
      - amount_str: fixed 2 decimal places; signed-zero normalised to "0.00"
      - payee_normalized: lowercase, leading/trailing whitespace stripped,
        internal multiple spaces collapsed to single space
    """
    amount_str = f"{amount:.2f}"
    # Normalise signed zero: Decimal("-0.00") formats as "-0.00", which would
    # produce a different hash from "0.00" for the same logical value. The
    # frontend's Web Crypto hash normalises -0 to "0.00" via Object.is, so we
    # must do the same here to keep the two implementations in sync.
    if float(amount_str) == 0:
        amount_str = "0.00"
    payee_normalized = _normalize_payee(payee)
    raw = f"{account_id}|{date_.isoformat()}|{amount_str}|{payee_normalized}"
    return hashlib.sha256(raw.encode()).hexdigest()
