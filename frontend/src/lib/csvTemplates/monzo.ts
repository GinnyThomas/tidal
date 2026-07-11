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
import { parseDDMMYYYY } from './dateUtils'

export const monzoTemplate: CsvTemplate = {
  id: 'monzo',
  name: 'Monzo',

  matches(headers: string[]): boolean {
    // "transaction id" + "notes and #tags" are unique to Monzo
    return (
      headers.includes('transaction id') &&
      headers.some(h => h.includes('notes and #tags'))
    )
  },

  parse(row: Record<string, string>): ParsedRow | null {
    const dateStr = row['Date']?.trim()
    const amountStr = row['Amount']?.trim()
    const payee = row['Name']?.trim() || ''

    if (!dateStr || amountStr === undefined || amountStr === '') return null

    const date = parseDDMMYYYY(dateStr)
    if (!date) return null

    const amount = parseFloat(amountStr)
    if (isNaN(amount)) return null

    const formattedAmount = amount.toFixed(2)
    const notes = row['Notes and #tags']?.trim() || undefined
    const externalId = row['Transaction ID']?.trim() || undefined

    return {
      date,
      amount: formattedAmount,
      payee,
      notes: notes || undefined,
      externalId: externalId || undefined,
    }
  },
}
