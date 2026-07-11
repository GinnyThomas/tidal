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
import { parseDate, parseAmount } from '../csvParsing'

export const virginTemplate: CsvTemplate = {
  id: 'virgin',
  name: 'Virgin Money',
  verified: true,

  matches(headers: string[]): boolean {
    // "billing amount" + "debit or credit" + "merchant" are unique to Virgin Money
    return (
      headers.includes('billing amount') &&
      headers.includes('debit or credit') &&
      headers.includes('merchant')
    )
  },

  parse(row: Record<string, string>): ParsedRow | { error: string } | null {
    const dateStr = row['Transaction Date']?.trim() ?? ''
    const billingStr = row['Billing Amount']?.trim() ?? ''
    const debitOrCredit = row['Debit or Credit']?.trim().toUpperCase() ?? ''

    // Blank row — silently skip
    if (!dateStr && !billingStr) return null

    const dateResult = parseDate(dateStr, 'YYYY-MM-DD')
    if ('error' in dateResult) return { error: dateResult.error }

    const amountResult = parseAmount(billingStr, '.')
    if ('error' in amountResult) return { error: amountResult.error }

    if (!debitOrCredit) return { error: 'Missing Debit or Credit indicator' }

    // DBIT = money out (negative), CRDT = money in (positive)
    const billing = parseFloat(amountResult.amount)
    const signed = debitOrCredit === 'CRDT' ? billing : -billing
    // Re-normalise after sign flip (handles -0 if billing was 0)
    const amount = Object.is(signed, -0) ? '0.00' : signed.toFixed(2)

    // Reference Number may be empty for pending transactions
    const refNumber = row['Reference Number']?.trim() || undefined

    return {
      date: dateResult.date,
      amount,
      payee: row['Merchant']?.trim() || '',
      externalId: refNumber || undefined,
    }
  },
}
