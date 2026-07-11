// lib/csvTemplates/santanderEs.ts
//
// Template for Santander Spain account XLSX exports.
//
// IMPORTANT: Santander España exports as XLSX (Excel), not CSV.
// This template works on rows that have been pre-parsed from XLSX using SheetJS
// (the `xlsx` npm package). The ImportCsvPage handles XLSX detection and
// converts the sheet data to the same Record<string, string> format before
// calling this template.
//
// XLSX structure (from actual sample):
//   Rows 0–5: account metadata (IBAN, holder name, balance header etc.)
//   Row 6 (0-indexed): column headers
//     → Transaction date, Value date, Description, Amount, Balance, Currency
//   Rows 7+: transaction data
//
// Key format details:
//   Date:       "Transaction date", DD/MM/YYYY  (e.g. "07/07/2026")
//   Amount:     "Amount" column, Spanish format:
//               - Decimal separator: comma  (e.g. "−31,95")
//               - Thousands separator: period (e.g. "−1.000,00")
//               - Uses Unicode MINUS SIGN U+2212 (−), NOT ASCII hyphen-minus (-)
//   Payee:      "Description" column
//   Notes:      None (Description doubles as both payee and notes)
//   External ID: None
//   Currency:   "Currency" column (EUR) — ignored; account currency used by backend
//   Balance:    "Balance" column — safely ignored

import type { CsvTemplate, ParsedRow } from '../csvTemplates'
import { parseDDMMYYYY } from './dateUtils'

// Unicode MINUS SIGN (U+2212) — Santander uses this instead of ASCII hyphen-minus
const UNICODE_MINUS = '\u2212'

/**
 * Parse a Spanish-format decimal string to a JS number.
 * Handles: Unicode minus, period-thousands, comma-decimal.
 * e.g. "−1.000,00" → -1000.00
 *      "−31,95"    → -31.95
 *      "4.796,72"  → 4796.72
 */
function parseSpanishAmount(raw: string): number | null {
  if (!raw) return null
  // Replace Unicode minus with ASCII minus
  let s = raw.replace(UNICODE_MINUS, '-')
  // Remove thousands separators. Santander ES uses period as thousands separator
  // and comma as the decimal separator, so ALL periods in the string are thousands
  // separators and can be stripped unconditionally before converting the decimal comma.
  // (The regex /\.(?=\d{3})/g only removes the first separator on amounts ≥ 1,000,000.)
  s = s.replace(/\./g, '')
  // Replace comma decimal separator with period
  s = s.replace(',', '.')
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

export const santanderEsTemplate: CsvTemplate = {
  id: 'santander_es',
  name: 'Santander España',

  matches(headers: string[]): boolean {
    // "transaction date" + "value date" + "description" are characteristic of
    // Santander ES. "balance" and "currency" are also present.
    return (
      headers.includes('transaction date') &&
      headers.includes('value date') &&
      headers.includes('description') &&
      headers.includes('amount') &&
      headers.includes('balance')
    )
  },

  parse(row: Record<string, string>): ParsedRow | null {
    const dateStr = row['Transaction date']?.trim()
    const amountStr = row['Amount']?.trim()
    const payee = row['Description']?.trim() || ''

    if (!dateStr || !amountStr) return null

    const date = parseDDMMYYYY(dateStr)
    if (!date) return null

    const amount = parseSpanishAmount(amountStr)
    if (amount === null) return null

    return {
      date,
      amount: amount.toFixed(2),
      payee,
    }
  },
}
