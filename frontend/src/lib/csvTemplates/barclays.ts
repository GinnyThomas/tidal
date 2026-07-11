// lib/csvTemplates/barclays.ts
//
// TODO: No sample file was provided for Barclays UK. This is a stub template
// based on the standard Barclays current account CSV export format documented
// publicly. Verify against a real export before relying on it.
//
// Expected Barclays UK CSV headers (standard format):
//   Number, Date, Account, Amount, Subcategory, Memo
//
// Key format details (assumed from Barclays documentation):
//   Date:       DD/MM/YYYY  (e.g. "15/01/2026")
//   Amount:     Single signed column, period decimal separator
//               Negative = debit, positive = credit
//   Payee:      "Memo" column (transaction description)
//   Notes:      None (Memo is the only description field)
//   External ID: None (no bank-provided ID in standard Barclays CSV)
//   Subcategory: Barclays category label — ignored (Tidal uses its own categories)
//
// If the real export has different headers, update the matches() predicate.

import type { CsvTemplate, ParsedRow } from '../csvTemplates'
import { parseDDMMYYYY } from './dateUtils'

export const barclaysTemplate: CsvTemplate = {
  id: 'barclays',
  name: 'Barclays UK',

  matches(headers: string[]): boolean {
    // "subcategory" + "memo" + "number" are distinctive to the Barclays format.
    // TODO: Verify against a real Barclays export — this is a stub.
    return (
      headers.includes('number') &&
      headers.includes('subcategory') &&
      headers.includes('memo') &&
      headers.includes('amount')
    )
  },

  parse(row: Record<string, string>): ParsedRow | null {
    // TODO: Verify column names against a real Barclays export.
    const dateStr = row['Date']?.trim()
    const amountStr = row['Amount']?.trim()
    const payee = row['Memo']?.trim() || ''

    if (!dateStr || amountStr === undefined || amountStr === '') return null

    const date = parseDDMMYYYY(dateStr)
    if (!date) return null

    const amount = parseFloat(amountStr)
    if (isNaN(amount)) return null

    return {
      date,
      amount: amount.toFixed(2),
      payee,
    }
  },
}
