// lib/csvTemplates/virgin.ts
//
// Template for Virgin Money credit card CSV exports.
//
// Sample headers (from actual export):
//   Transaction Date, Posting Date, Billing Amount, Merchant, Merchant City,
//   Merchant State, Merchant Postcode, Reference Number, Debit or Credit,
//   SICMCC Code, Status, Transaction Currency, Additional Card Holder, Card Used
//
// Key format details:
//   Date:       "Transaction Date", YYYY-MM-DD  (e.g. "2026-07-07")
//   Amount:     "Billing Amount" is always positive.
//               Sign determined by "Debit or Credit": "DBIT" → negative, "CRDT" → positive
//   Payee:      "Merchant" column
//   Notes:      None (no dedicated notes field)
//   External ID: "Reference Number" column (may be empty for pending rows)
//   Status:     "Status" column ("BILLED" or "PENDING") — not used in import but noted

import type { CsvTemplate, ParsedRow } from '../csvTemplates'

export const virginTemplate: CsvTemplate = {
  id: 'virgin',
  name: 'Virgin Money',

  matches(headers: string[]): boolean {
    // "billing amount" + "debit or credit" + "merchant" are unique to Virgin Money
    return (
      headers.includes('billing amount') &&
      headers.includes('debit or credit') &&
      headers.includes('merchant')
    )
  },

  parse(row: Record<string, string>): ParsedRow | null {
    const dateStr = row['Transaction Date']?.trim()
    const billingStr = row['Billing Amount']?.trim()
    const debitOrCredit = row['Debit or Credit']?.trim().toUpperCase()
    const payee = row['Merchant']?.trim() || ''

    if (!dateStr || !billingStr || !debitOrCredit) return null

    // Date is already YYYY-MM-DD — validate it
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null

    const billing = parseFloat(billingStr)
    if (isNaN(billing)) return null

    // DBIT = money out (negative), CRDT = money in (positive)
    const signed = debitOrCredit === 'CRDT' ? billing : -billing
    const formattedAmount = signed.toFixed(2)

    // Reference Number may be empty for pending transactions
    const refNumber = row['Reference Number']?.trim() || undefined

    return {
      date: dateStr,
      amount: formattedAmount,
      payee,
      externalId: refNumber || undefined,
    }
  },
}
