// lib/csvTemplates/barclays.ts
//
// Unverified — awaiting a real Barclays export sample.
// Excluded from auto-detection (verified: false) until a sample is provided
// and this flag is flipped. A false-positive auto-match is worse than falling
// through to manual mapping and silently misparsing a real file.
//
// Expected Barclays UK CSV headers (standard format, from public docs):
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
// TODO: Verify all of the above against a real Barclays export, then set verified: true.

import type { CsvTemplate, ParsedRow } from '../csvTemplates'
import { parseDate, parseAmount } from '../csvParsing'

export const barclaysTemplate: CsvTemplate = {
  id: 'barclays',
  name: 'Barclays UK',
  verified: false, // Unverified stub — excluded from auto-detection

  matches(headers: string[]): boolean {
    // "subcategory" + "memo" + "number" are distinctive to the Barclays format.
    // TODO: Verify against a real Barclays export.
    return (
      headers.includes('number') &&
      headers.includes('subcategory') &&
      headers.includes('memo') &&
      headers.includes('amount')
    )
  },

  parse(row: Record<string, string>): ParsedRow | { error: string } | null {
    // TODO: Verify column names against a real Barclays export.
    const dateStr = row['Date']?.trim() ?? ''
    const amountStr = row['Amount']?.trim() ?? ''

    // Blank row — silently skip
    if (!dateStr && !amountStr) return null

    const dateResult = parseDate(dateStr, 'DD/MM/YYYY')
    if ('error' in dateResult) return { error: dateResult.error }

    const amountResult = parseAmount(amountStr, '.')
    if ('error' in amountResult) return { error: amountResult.error }

    return {
      date: dateResult.date,
      amount: amountResult.amount,
      payee: row['Memo']?.trim() || '',
    }
  },
}
