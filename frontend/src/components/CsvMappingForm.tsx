// components/CsvMappingForm.tsx
//
// Manual CSV column mapping UI — shown when no built-in template matches and
// no saved mapping exists for the account.
//
// Props:
//   headers       — column names detected in the uploaded CSV
//   sampleRows    — first 3 rows for the live preview
//   accountName   — displayed in the "save for {account}" checkbox label
//   onSave        — called with the resolved mapping config + whether to persist

import { useState } from 'react'
import type { ParsedRow } from '../lib/csvTemplates'
import { parseDate, parseAmount } from '../lib/csvParsing'
import type { DateFormat, DecimalSeparator } from '../lib/csvParsing'

export type AmountMode = 'single' | 'debit_credit'
export type { DateFormat, DecimalSeparator }

export interface MappingConfig {
  dateColumn: string
  dateFormat: DateFormat
  amountMode: AmountMode
  amountColumn: string        // used when amountMode = 'single'
  debitColumn: string         // used when amountMode = 'debit_credit'
  creditColumn: string        // used when amountMode = 'debit_credit'
  payeeColumn: string
  notesColumn: string
  externalIdColumn: string
  decimalSeparator: DecimalSeparator
}

type Props = {
  headers: string[]
  sampleRows: Record<string, string>[]
  accountName: string
  onSave: (config: MappingConfig, saveForAccount: boolean) => void
}

// Used for the live preview only. Converts errors to null (preview already shows
// "Failed to parse" for null rows). The actual import path in ImportCsvPage uses
// the same parseDate/parseAmount calls but collects errors to surface to the user.
function parseWithConfig(
  row: Record<string, string>,
  config: MappingConfig,
): ParsedRow | null {
  const dateRaw = row[config.dateColumn]?.trim() ?? ''
  const dateResult = parseDate(dateRaw, config.dateFormat)
  if ('error' in dateResult) return null

  const sep = config.decimalSeparator

  function resolveAmount(): string | null {
    if (config.amountMode === 'single') {
      const r = parseAmount(row[config.amountColumn] ?? '', sep)
      return 'error' in r ? null : r.amount
    }
    // debit_credit mode
    const debitRaw = row[config.debitColumn] ?? ''
    const creditRaw = row[config.creditColumn] ?? ''
    const debitResult = debitRaw ? parseAmount(debitRaw, sep) : null
    const creditResult = creditRaw ? parseAmount(creditRaw, sep) : null
    const debit = debitResult && !('error' in debitResult) ? parseFloat(debitResult.amount) : null
    const credit = creditResult && !('error' in creditResult) ? parseFloat(creditResult.amount) : null
    if (debit !== null && debit !== 0) return (-Math.abs(debit)).toFixed(2)
    if (credit !== null && credit !== 0) return Math.abs(credit).toFixed(2)
    return '0.00'
  }

  const amount = resolveAmount()
  if (amount === null) return null

  const payee = row[config.payeeColumn]?.trim() || ''
  const notes = config.notesColumn ? row[config.notesColumn]?.trim() : undefined
  const externalId = config.externalIdColumn ? row[config.externalIdColumn]?.trim() : undefined

  return {
    date: dateResult.date,
    amount,
    payee,
    notes: notes || undefined,
    externalId: externalId || undefined,
  }
}

export default function CsvMappingForm({ headers, sampleRows, accountName, onSave }: Props) {
  const none = ''
  const [dateColumn, setDateColumn] = useState(headers[0] || none)
  const [dateFormat, setDateFormat] = useState<DateFormat>('DD/MM/YYYY')
  const [amountMode, setAmountMode] = useState<AmountMode>('single')
  const [amountColumn, setAmountColumn] = useState(headers[1] || none)
  const [debitColumn, setDebitColumn] = useState(headers[1] || none)
  const [creditColumn, setCreditColumn] = useState(headers[2] || none)
  const [payeeColumn, setPayeeColumn] = useState(headers[2] || none)
  const [notesColumn, setNotesColumn] = useState(none)
  const [externalIdColumn, setExternalIdColumn] = useState(none)
  const [decimalSeparator, setDecimalSeparator] = useState<DecimalSeparator>('.')
  const [saveForAccount, setSaveForAccount] = useState(true)

  const config: MappingConfig = {
    dateColumn,
    dateFormat,
    amountMode,
    amountColumn,
    debitColumn,
    creditColumn,
    payeeColumn,
    notesColumn,
    externalIdColumn,
    decimalSeparator,
  }

  const previewRows = sampleRows.slice(0, 3).map(row => parseWithConfig(row, config))
  const hasErrors = previewRows.some(r => r === null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSave(config, saveForAccount)
  }

  const colOptions = (
    <>
      <option value="">— None —</option>
      {headers.map(h => <option key={h} value={h}>{h}</option>)}
    </>
  )

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h3 className="text-lg font-semibold text-ocean-100">Map columns</h3>
      <p className="text-sm text-ocean-300">
        We couldn't recognise this file automatically. Tell us which column is which.
      </p>

      <div className="grid grid-cols-2 gap-4">
        {/* Date */}
        <div>
          <label className="label-base">Date column <span className="text-danger">*</span></label>
          <select className="input-base" value={dateColumn} onChange={e => setDateColumn(e.target.value)} required>
            {colOptions}
          </select>
        </div>
        <div>
          <label className="label-base">Date format <span className="text-danger">*</span></label>
          <select className="input-base" value={dateFormat} onChange={e => setDateFormat(e.target.value as DateFormat)}>
            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
            <option value="MM/DD/YYYY">MM/DD/YYYY</option>
            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
          </select>
        </div>

        {/* Amount mode */}
        <div className="col-span-2">
          <label className="label-base">Amount column(s) <span className="text-danger">*</span></label>
          <div className="flex gap-4 mt-1">
            <label className="flex items-center gap-2 text-sm text-ocean-200 cursor-pointer">
              <input type="radio" value="single" checked={amountMode === 'single'} onChange={() => setAmountMode('single')} />
              Single signed column
            </label>
            <label className="flex items-center gap-2 text-sm text-ocean-200 cursor-pointer">
              <input type="radio" value="debit_credit" checked={amountMode === 'debit_credit'} onChange={() => setAmountMode('debit_credit')} />
              Separate debit / credit columns
            </label>
          </div>
        </div>

        {amountMode === 'single' ? (
          <div className="col-span-2">
            <label className="label-base">Amount column <span className="text-danger">*</span></label>
            <select className="input-base" value={amountColumn} onChange={e => setAmountColumn(e.target.value)} required>
              {colOptions}
            </select>
          </div>
        ) : (
          <>
            <div>
              <label className="label-base">Debit column <span className="text-danger">*</span></label>
              <select className="input-base" value={debitColumn} onChange={e => setDebitColumn(e.target.value)} required>
                {colOptions}
              </select>
            </div>
            <div>
              <label className="label-base">Credit column <span className="text-danger">*</span></label>
              <select className="input-base" value={creditColumn} onChange={e => setCreditColumn(e.target.value)} required>
                {colOptions}
              </select>
            </div>
          </>
        )}

        {/* Decimal separator */}
        <div>
          <label className="label-base">Decimal separator</label>
          <select className="input-base" value={decimalSeparator} onChange={e => setDecimalSeparator(e.target.value as DecimalSeparator)}>
            <option value=".">Period  (1,234.56)</option>
            <option value=",">, Comma (1.234,56)</option>
          </select>
        </div>

        {/* Payee */}
        <div>
          <label className="label-base">Payee column <span className="text-danger">*</span></label>
          <select className="input-base" value={payeeColumn} onChange={e => setPayeeColumn(e.target.value)} required>
            {colOptions}
          </select>
        </div>

        {/* Notes (optional) */}
        <div>
          <label className="label-base">Notes column (optional)</label>
          <select className="input-base" value={notesColumn} onChange={e => setNotesColumn(e.target.value)}>
            {colOptions}
          </select>
        </div>

        {/* External ID (optional) */}
        <div>
          <label className="label-base">External ID column (optional)</label>
          <select className="input-base" value={externalIdColumn} onChange={e => setExternalIdColumn(e.target.value)}>
            {colOptions}
          </select>
        </div>
      </div>

      {/* Live preview */}
      <div className="mt-4">
        <h4 className="text-sm font-semibold text-ocean-200 mb-2">Preview (first 3 rows)</h4>
        <div className="overflow-x-auto rounded border border-ocean-600">
          <table className="w-full text-xs text-ocean-200">
            <thead className="bg-ocean-700">
              <tr>
                <th className="px-2 py-1 text-left">Date</th>
                <th className="px-2 py-1 text-right">Amount</th>
                <th className="px-2 py-1 text-left">Payee</th>
                <th className="px-2 py-1 text-center">OK?</th>
              </tr>
            </thead>
            <tbody>
              {sampleRows.slice(0, 3).map((_, i) => {
                const parsed = previewRows[i]
                return (
                  <tr key={i} className="border-t border-ocean-600">
                    {parsed ? (
                      <>
                        <td className="px-2 py-1">{parsed.date}</td>
                        <td className="px-2 py-1 text-right font-mono">{parsed.amount}</td>
                        <td className="px-2 py-1 truncate max-w-32">{parsed.payee}</td>
                        <td className="px-2 py-1 text-center text-success">✓</td>
                      </>
                    ) : (
                      <>
                        <td colSpan={3} className="px-2 py-1 text-danger italic">Failed to parse</td>
                        <td className="px-2 py-1 text-center text-danger">✗</td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {hasErrors && (
          <p className="mt-1 text-xs text-danger">
            Some rows failed to parse. Check your column selections and date format.
          </p>
        )}
      </div>

      {/* Save checkbox */}
      <label className="flex items-center gap-2 text-sm text-ocean-200 cursor-pointer">
        <input
          type="checkbox"
          checked={saveForAccount}
          onChange={e => setSaveForAccount(e.target.checked)}
        />
        Save this mapping for {accountName}
      </label>

      <button type="submit" className="btn-primary" disabled={hasErrors}>
        Save &amp; Continue
      </button>
    </form>
  )
}
