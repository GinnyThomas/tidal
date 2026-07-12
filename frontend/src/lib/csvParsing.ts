// lib/csvParsing.ts
//
// Shared parsing helpers used by both CsvMappingForm (live preview) and
// ImportCsvPage (actual import). Both code paths feed the dedup hash, so
// they MUST use identical parsing logic — this module is the single source
// of truth.

// ─── Types ───────────────────────────────────────────────────────────────────

export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'
export type DecimalSeparator = '.' | ','

// ─── parseDate ────────────────────────────────────────────────────────────────

/**
 * Parse a raw date string to ISO YYYY-MM-DD.
 * Returns { date } on success, { error } on failure.
 */
export function parseDate(
  raw: string,
  format: DateFormat,
): { date: string } | { error: string } {
  const s = raw.trim()
  if (!s) return { error: 'Empty date' }

  if (format === 'DD/MM/YYYY') {
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    if (!m) return { error: `Invalid date (expected DD/MM/YYYY): "${s}"` }
    const [, dd, mm, yyyy] = m
    const d = parseInt(dd, 10)
    const mo = parseInt(mm, 10)
    const y = parseInt(yyyy, 10)
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900) {
      return { error: `Out-of-range date: "${s}"` }
    }
    return { date: `${yyyy}-${mm}-${dd}` }
  }

  if (format === 'MM/DD/YYYY') {
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    if (!m) return { error: `Invalid date (expected MM/DD/YYYY): "${s}"` }
    const [, mm, dd, yyyy] = m
    return { date: `${yyyy}-${mm}-${dd}` }
  }

  // YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return { error: `Invalid date (expected YYYY-MM-DD): "${s}"` }
  }
  return { date: s }
}

// ─── parseAmount ─────────────────────────────────────────────────────────────

/**
 * Parse a raw amount string with the specified decimal separator.
 *
 * Period decimal  ('.'): strips comma thousands-separators.
 * Comma  decimal  (','): strips ALL period thousands-separators, then swaps comma→period.
 *
 * Returns { amount: '12.34' } on success (always 2 dp, signed-zero normalised to '0.00'),
 * or { error } on failure.
 *
 * Does NOT handle currency symbols — strip those before calling if needed.
 */
export function parseAmount(
  raw: string,
  decimalSeparator: DecimalSeparator,
): { amount: string } | { error: string } {
  if (!raw) return { error: 'Empty amount' }
  let s = raw.trim()
  if (!s) return { error: 'Empty amount' }

  // Some banks (e.g. Santander España) use the Unicode MINUS SIGN (U+2212, "−")
  // instead of ASCII hyphen-minus. parseFloat() doesn't recognise U+2212 at
  // all, so every negative amount would fail to parse — normalise it here,
  // in the shared parser, so this works for manual column mapping too, not
  // just banks with a dedicated template.
  s = s.replace(/−/g, '-')

  if (decimalSeparator === ',') {
    // Thousands sep = period → strip all periods unconditionally.
    // Decimal sep = comma → swap to period.
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    // Thousands sep = comma → strip commas.
    s = s.replace(/,/g, '')
  }

  const n = parseFloat(s)
  if (isNaN(n)) return { error: `Amount not numeric: "${raw}"` }

  // Normalise -0 to 0 so the dedup hash matches the backend's behaviour.
  // Object.is distinguishes -0 from 0; toFixed() does not in all JS engines.
  return { amount: Object.is(n, -0) ? '0.00' : n.toFixed(2) }
}

// ─── clampPayee ──────────────────────────────────────────────────────────────

// Transaction.payee is capped at 100 chars server-side (TransactionCreate,
// ImportTransactionRow). Some banks routinely exceed it — Spanish direct
// debit descriptions in particular ("RECIBO ... REF. MANDATO ...") regularly
// run past 150 characters. Since the import request sends every row's payee
// in a single batch, ONE overlong row fails Pydantic validation for the
// entire request, silently blocking every other row in the file too.
export const MAX_PAYEE_LENGTH = 100

/**
 * Enforces the 100-char payee limit without losing information: the
 * overflow is preserved in `notes` (which has no length limit) rather than
 * silently discarded. Called once, right after parsing and before the dedup
 * hash is computed, so the value reviewed on-screen matches what's actually
 * submitted and hashed.
 */
export function clampPayee(rawPayee: string, notes?: string): { payee: string; notes?: string } {
  if (rawPayee.length <= MAX_PAYEE_LENGTH) return { payee: rawPayee, notes }
  const payee = rawPayee.slice(0, MAX_PAYEE_LENGTH)
  return { payee, notes: notes ? `${rawPayee} — ${notes}` : rawPayee }
}
