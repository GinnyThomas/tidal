// lib/csvTemplates/monzo.ts
//
// Template for Monzo bank CSV exports.
//
// Sample headers (from actual export):
//   Transaction ID, Date, Time, Type, Name, Emoji, Category, Amount, Currency,
//   Local amount, Local currency, Notes and #tags, Address, Receipt,
//   Description, Category split, Money Out, Money In
//
// Key format details:
//   Date:       DD/MM/YYYY  (e.g. "01/04/2026")
//   Amount:     Single signed column, period decimal separator
//               Negative = debit, positive = credit
//   Payee:      "Name" column
//   Notes:      "Notes and #tags" column
//   External ID: "Transaction ID" column (e.g. "tx_0000B4q3...")
//   Currency:   "Currency" column (ignored — account currency used by backend)
//   Quoted commas: Yes ("Hoai Dang,Hoai Thu W Dang") — papaparse handles

import type { CsvTemplate, ParsedRow } from '../csvTemplates'
import { parseDate, parseAmount } from '../csvParsing'

export const monzoTemplate: CsvTemplate = {
  id: 'monzo',
  name: 'Monzo',
  verified: true,

  matches(headers: string[]): boolean {
    // "transaction id" + "notes and #tags" are unique to Monzo
    return (
      headers.includes('transaction id') &&
      headers.some(h => h.includes('notes and #tags'))
    )
  },

  parse(row: Record<string, string>): ParsedRow | { error: string } | null {
    const dateStr = row['Date']?.trim() ?? ''
    const amountStr = row['Amount']?.trim() ?? ''

    // Blank row — silently skip
    if (!dateStr && !amountStr) return null

    const dateResult = parseDate(dateStr, 'DD/MM/YYYY')
    if ('error' in dateResult) return { error: dateResult.error }

    const amountResult = parseAmount(amountStr, '.')
    if ('error' in amountResult) return { error: amountResult.error }

    const notes = row['Notes and #tags']?.trim() || undefined
    const externalId = row['Transaction ID']?.trim() || undefined

    return {
      date: dateResult.date,
      amount: amountResult.amount,
      payee: row['Name']?.trim() || '',
      notes: notes || undefined,
      externalId: externalId || undefined,
    }
  },
}
