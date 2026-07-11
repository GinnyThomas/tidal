// pages/ImportCsvPage.tsx
//
// Multi-step CSV import flow:
//
//   Step 1 — Choose file + account
//     Account dropdown, .csv / .xlsx file input.
//     Parses with papaparse (CSV) or SheetJS (XLSX).
//     Attempts template detection or saved-mapping lookup.
//
//   Step 2 — Mapping (skipped if template or saved mapping found)
//     Shows CsvMappingForm; user maps columns manually.
//
//   Step 3 — Review
//     Table of all parsed rows.
//     Client-side dedup: classify as New / Definite Duplicate / Possible Duplicate.
//     User can toggle excluded rows to include them.
//
//   Step 4 — Result
//     Shows success summary and redirects to transactions page.

import axios from 'axios'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import CsvMappingForm from '../components/CsvMappingForm'
import type { MappingConfig } from '../components/CsvMappingForm'
import { detectTemplate, ALL_TEMPLATES } from '../lib/csvTemplates'
import type { CsvTemplate, ParsedRow } from '../lib/csvTemplates'
import { computeDedupHash } from '../lib/dedupHash'
import { getApiBaseUrl } from '../lib/api'

type Account = { id: string; name: string; currency: string }

type ClassifiedRow = ParsedRow & {
  status: 'new' | 'definite_duplicate' | 'possible_duplicate'
  included: boolean
}

type Step = 'pick' | 'mapping' | 'review' | 'done'

// Apply a saved MappingConfig (returned from /api/v1/csv-mappings) to raw rows
function applyMappingConfig(
  rows: Record<string, string>[],
  config: MappingConfig,
): ParsedRow[] {
  return rows
    .map(row => {
      // Inline parse using the same logic as CsvMappingForm
      const dateRaw = row[config.dateColumn]?.trim()
      if (!dateRaw) return null

      let date: string | null = null
      if (config.dateFormat === 'DD/MM/YYYY') {
        const m = dateRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
        if (m) date = `${m[3]}-${m[2]}-${m[1]}`
      } else if (config.dateFormat === 'MM/DD/YYYY') {
        const m = dateRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
        if (m) date = `${m[3]}-${m[1]}-${m[2]}`
      } else {
        date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null
      }
      if (!date) return null

      const sep = config.decimalSeparator
      function parseAmt(raw: string): number | null {
        if (!raw) return null
        let s = raw.trim()
        if (sep === ',') {
          s = s.replace(/\./g, '').replace(',', '.')
        } else {
          s = s.replace(/,(?=\d{3})/g, '')
        }
        const n = parseFloat(s)
        return isNaN(n) ? null : n
      }

      let amount: number | null = null
      if (config.amountMode === 'single') {
        amount = parseAmt(row[config.amountColumn] ?? '')
      } else {
        const debit = parseAmt(row[config.debitColumn] ?? '')
        const credit = parseAmt(row[config.creditColumn] ?? '')
        if (debit !== null && debit !== 0) amount = -Math.abs(debit)
        else if (credit !== null && credit !== 0) amount = Math.abs(credit)
        else amount = 0
      }
      if (amount === null) return null

      return {
        date,
        amount: amount.toFixed(2),
        payee: row[config.payeeColumn]?.trim() || '',
        notes: config.notesColumn ? row[config.notesColumn]?.trim() || undefined : undefined,
        externalId: config.externalIdColumn ? row[config.externalIdColumn]?.trim() || undefined : undefined,
      } as ParsedRow
    })
    .filter((r): r is ParsedRow => r !== null)
}

export default function ImportCsvPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('pick')

  // Step 1 state
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [detectedTemplate, setDetectedTemplate] = useState<CsvTemplate | null>(null)
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [fileLoading, setFileLoading] = useState(false)

  // Step 1 error state
  const [accountsError, setAccountsError] = useState<string | null>(null)

  // Step 3 state
  const [classifiedRows, setClassifiedRows] = useState<ClassifiedRow[]>([])
  const [dedupLoading, setDedupLoading] = useState(false)
  const [dedupError, setDedupError] = useState<string | null>(null)

  // Step 4 state
  const [importResult, setImportResult] = useState<{ created: number; skipped_duplicates: number } | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const selectedAccount = accounts.find(a => a.id === selectedAccountId)

  useEffect(() => {
    axios
      .get(`${getApiBaseUrl()}/api/v1/accounts`)
      .then(r => {
        setAccounts(r.data)
        if (r.data.length > 0) setSelectedAccountId(r.data[0].id)
      })
      .catch(() => setAccountsError('Failed to load accounts. Please refresh the page.'))
  }, [])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileError(null)
    setFileLoading(true)

    try {
      const isXlsx = file.name.endsWith('.xlsx') || file.name.endsWith('.xls')
      let rows: Record<string, string>[] = []
      let hdrs: string[] = []

      if (isXlsx) {
        // Parse XLSX with SheetJS
        const buffer = await file.arrayBuffer()
        const wb = XLSX.read(buffer)
        const ws = wb.Sheets[wb.SheetNames[0]]
        const allRows: (string | null)[][] = XLSX.utils.sheet_to_json(ws, {
          header: 1,
          defval: null,
          raw: false,
        })

        // Find the header row: use the first row that has as many non-empty cells
        // as the densest row in the sheet. This skips sparse metadata rows (e.g.
        // account name, IBAN) that appear before the real column headers in many
        // bank exports. Data rows and the header row share the same cell count,
        // so indexOf returns the header row (which comes first).
        const nonEmptyCounts = allRows.map(r =>
          r.filter(c => c !== null && String(c).trim() !== '').length,
        )
        const maxCount = Math.max(...nonEmptyCounts)
        const headerRowIndex = maxCount >= 2 ? nonEmptyCounts.indexOf(maxCount) : -1
        if (headerRowIndex === -1) {
          setFileError('Could not find a header row in the XLSX file.')
          return
        }
        hdrs = allRows[headerRowIndex].map(c => String(c ?? '').trim()).filter(Boolean)

        rows = allRows
          .slice(headerRowIndex + 1)
          .filter(row => row.some(c => c !== null && String(c).trim() !== ''))
          .map(row => {
            const obj: Record<string, string> = {}
            hdrs.forEach((h, i) => { obj[h] = String(row[i] ?? '').trim() })
            return obj
          })
      } else {
        // Parse CSV with papaparse
        const text = await file.text()
        const result = Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
        })
        if (result.errors.length > 0) {
          setFileError(`CSV parse error: ${result.errors[0].message}`)
          return
        }
        rows = result.data
        hdrs = result.meta.fields ?? []
      }

      setRawRows(rows)
      setHeaders(hdrs)

      // Try to detect a template from the headers
      const tmpl = detectTemplate(hdrs)

      if (tmpl) {
        setDetectedTemplate(tmpl)
        const parsed = rows.map(r => tmpl.parse(r)).filter((r): r is ParsedRow => r !== null)
        setParsedRows(parsed)
        await runDedup(parsed, selectedAccountId)
        setStep('review')
      } else {
        // Check for a saved mapping
        try {
          const mappingResp = await axios.get(
            `${getApiBaseUrl()}/api/v1/csv-mappings/${selectedAccountId}`,
          )
          const savedConfig: MappingConfig = mappingResp.data.mapping_json
          const parsed = applyMappingConfig(rows, savedConfig)
          setParsedRows(parsed)
          await runDedup(parsed, selectedAccountId)
          setStep('review')
        } catch {
          // No saved mapping — show manual mapping UI
          setDetectedTemplate(null)
          setStep('mapping')
        }
      }
    } catch (err) {
      setFileError('Failed to read file. Please try again.')
      console.error(err)
    } finally {
      setFileLoading(false)
    }
  }

  async function runDedup(rows: ParsedRow[], accountId: string) {
    setDedupLoading(true)
    setDedupError(null)
    try {
      if (rows.length === 0) {
        setClassifiedRows([])
        return
      }

      // Compute date range for the fetch
      const dates = rows.map(r => r.date).sort()
      const minDate = dates[0]
      const maxDate = dates[dates.length - 1]

      // Fetch ALL existing transactions in this date range (paginated — the API
      // caps page_size at 500, so we loop until we have the full set).
      type TxItem = { dedup_hash?: string; external_id?: string; date: string; amount: string; payee?: string | null }
      const existing: TxItem[] = []
      let page = 1
      const PAGE_SIZE = 500
      while (true) {
        const resp = await axios.get(`${getApiBaseUrl()}/api/v1/transactions`, {
          params: { account_id: accountId, date_from: minDate, date_to: maxDate, page, page_size: PAGE_SIZE },
        })
        const batch: TxItem[] = resp.data.items
        const total: number = resp.data.total
        existing.push(...batch)
        if (existing.length >= total || batch.length < PAGE_SIZE) break
        page++
      }

      const existingHashes = new Set(existing.map(t => t.dedup_hash).filter(Boolean))
      const existingExtIds = new Set(existing.map(t => t.external_id).filter(Boolean))

      const batchHashes = new Set<string>()
      const batchExtIds = new Set<string>()

      const classified: ClassifiedRow[] = await Promise.all(
        rows.map(async row => {
          // external_id takes precedence
          if (row.externalId) {
            if (existingExtIds.has(row.externalId) || batchExtIds.has(row.externalId)) {
              batchExtIds.add(row.externalId)
              return { ...row, status: 'definite_duplicate' as const, included: false }
            }
            batchExtIds.add(row.externalId)
          }

          const hash = await computeDedupHash(accountId, row.date, row.amount, row.payee)

          if (existingHashes.has(hash) || batchHashes.has(hash)) {
            batchHashes.add(hash)
            return { ...row, status: 'definite_duplicate' as const, included: false }
          }
          batchHashes.add(hash)

          // Possible duplicate: same date + amount, different payee
          const possibleDup = existing.some(t => {
            if (t.date !== row.date) return false
            const existAmt = parseFloat(t.amount ?? '0').toFixed(2)
            const rowAmt = parseFloat(row.amount).toFixed(2)
            if (existAmt !== rowAmt) return false
            const existPayee = (t.payee ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
            const rowPayee = row.payee.trim().toLowerCase().replace(/\s+/g, ' ')
            return existPayee !== rowPayee
          })

          if (possibleDup) {
            return { ...row, status: 'possible_duplicate' as const, included: false }
          }

          return { ...row, status: 'new' as const, included: true }
        }),
      )

      setClassifiedRows(classified)
    } catch {
      // If the duplicate-check fetch fails, let the user proceed but warn them.
      // Mark all rows as new so the import button is available.
      setDedupError(
        'Could not check for duplicates — please review carefully before importing.',
      )
      setClassifiedRows(rows.map(row => ({ ...row, status: 'new' as const, included: true })))
    } finally {
      setDedupLoading(false)
    }
  }

  function handleMappingSave(config: MappingConfig, saveForAccount: boolean) {
    const parsed = applyMappingConfig(rawRows, config)
    setParsedRows(parsed)

    if (saveForAccount && selectedAccountId) {
      axios
        .post(`${getApiBaseUrl()}/api/v1/csv-mappings`, {
          account_id: selectedAccountId,
          name: `Custom mapping`,
          mapping_json: config,
        })
        .catch(err => console.warn('Failed to save mapping:', err))
    }

    runDedup(parsed, selectedAccountId).then(() => setStep('review'))
  }

  function toggleRow(index: number) {
    setClassifiedRows(prev =>
      prev.map((r, i) => i === index ? { ...r, included: !r.included } : r),
    )
  }

  async function handleConfirmImport() {
    const included = classifiedRows.filter(r => r.included)
    if (included.length === 0) return

    setImporting(true)
    setImportError(null)
    try {
      const resp = await axios.post(`${getApiBaseUrl()}/api/v1/transactions/import`, {
        account_id: selectedAccountId,
        transactions: included.map(r => ({
          date: r.date,
          amount: r.amount,
          payee: r.payee,
          notes: r.notes,
          external_id: r.externalId,
        })),
      })
      setImportResult(resp.data)
      setStep('done')
    } catch (err) {
      setImportError('Import failed. Please try again.')
      console.error(err)
    } finally {
      setImporting(false)
    }
  }

  const newCount = classifiedRows.filter(r => r.status === 'new').length
  const defDupCount = classifiedRows.filter(r => r.status === 'definite_duplicate').length
  const possibleDupCount = classifiedRows.filter(r => r.status === 'possible_duplicate').length
  const includedCount = classifiedRows.filter(r => r.included).length

  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-ocean-100 mb-6">Import CSV</h1>

        {/* ================================================================
            Step 1: Pick file + account
        ================================================================ */}
        {step === 'pick' && (
          <div className="space-y-6">
            {accountsError && (
              <p className="text-sm text-danger">{accountsError}</p>
            )}
            <div>
              <label className="label-base">Account</label>
              <select
                className="input-base"
                value={selectedAccountId}
                onChange={e => setSelectedAccountId(e.target.value)}
              >
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="csv-file-input" className="label-base">CSV or XLSX file</label>
              <input
                id="csv-file-input"
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                className="block w-full text-sm text-ocean-200 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-ocean-600 file:text-ocean-100 hover:file:bg-ocean-500 cursor-pointer"
                disabled={!selectedAccountId || fileLoading}
              />
              {fileLoading && <p className="mt-2 text-sm text-ocean-300">Parsing file…</p>}
              {fileError && <p className="mt-2 text-sm text-danger">{fileError}</p>}
            </div>

            <p className="text-xs text-ocean-400">
              Supported banks: Monzo, Virgin Money, Santander España (XLSX), Barclays UK.
              Other banks can be mapped manually.
            </p>
          </div>
        )}

        {/* ================================================================
            Step 2: Manual column mapping
        ================================================================ */}
        {step === 'mapping' && (
          <CsvMappingForm
            headers={headers}
            sampleRows={rawRows.slice(0, 3)}
            accountName={selectedAccount?.name ?? 'this account'}
            onSave={handleMappingSave}
          />
        )}

        {/* ================================================================
            Step 3: Review + dedup
        ================================================================ */}
        {step === 'review' && (
          <div className="space-y-4">
            {detectedTemplate && (
              <p className="text-sm text-ocean-300">
                Detected: <span className="font-semibold text-ocean-100">{detectedTemplate.name}</span>
                &nbsp;— {parsedRows.length} rows parsed.
              </p>
            )}

            {dedupLoading ? (
              <p className="text-sm text-ocean-300">Checking for duplicates…</p>
            ) : (
              <>
                {dedupError && (
                  <p className="text-sm text-warning">{dedupError}</p>
                )}
                <div className="flex gap-4 text-sm">
                  <span className="text-success font-medium">{newCount} new</span>
                  <span className="text-ocean-400">{defDupCount} skipped</span>
                  <span className="text-warning">{possibleDupCount} need review</span>
                </div>

                <div className="overflow-x-auto rounded border border-ocean-600 max-h-96">
                  <table className="w-full text-xs text-ocean-200 min-w-[500px]">
                    <thead className="bg-ocean-700 sticky top-0">
                      <tr>
                        <th className="px-2 py-2 text-center w-10">
                          <span className="sr-only">Include</span>
                        </th>
                        <th className="px-2 py-2 text-left">Date</th>
                        <th className="px-2 py-2 text-right">Amount</th>
                        <th className="px-2 py-2 text-left">Payee</th>
                        <th className="px-2 py-2 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {classifiedRows.map((row, i) => (
                        <tr
                          key={i}
                          className={[
                            'border-t border-ocean-600',
                            row.status === 'definite_duplicate' ? 'opacity-40 line-through' : '',
                            row.status === 'possible_duplicate' ? 'bg-warning/5' : '',
                          ].join(' ')}
                        >
                          <td className="px-2 py-1 text-center">
                            <input
                              type="checkbox"
                              checked={row.included}
                              onChange={() => toggleRow(i)}
                              aria-label={`Include row ${i + 1}`}
                            />
                          </td>
                          <td className="px-2 py-1">{row.date}</td>
                          <td className={`px-2 py-1 text-right font-mono ${parseFloat(row.amount) < 0 ? 'text-danger' : 'text-success'}`}>
                            {row.amount}
                          </td>
                          <td className="px-2 py-1 truncate max-w-40">{row.payee}</td>
                          <td className="px-2 py-1 text-center">
                            {row.status === 'new' && <span className="text-success">New</span>}
                            {row.status === 'definite_duplicate' && <span className="text-ocean-400">Duplicate</span>}
                            {row.status === 'possible_duplicate' && <span className="text-warning">Review</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {importError && <p className="text-sm text-danger">{importError}</p>}

                <div className="flex gap-3">
                  <button
                    className="btn-primary"
                    onClick={handleConfirmImport}
                    disabled={importing || includedCount === 0}
                  >
                    {importing ? 'Importing…' : `Import ${includedCount} transaction${includedCount !== 1 ? 's' : ''}`}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => setStep('pick')}
                  >
                    Back
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ================================================================
            Step 4: Result
        ================================================================ */}
        {step === 'done' && importResult && (
          <div className="space-y-4">
            <div className="rounded-lg bg-success/10 border border-success/30 px-6 py-4">
              <p className="text-success font-semibold text-lg">
                Imported {importResult.created} transaction{importResult.created !== 1 ? 's' : ''}
                {importResult.skipped_duplicates > 0 && `, skipped ${importResult.skipped_duplicates} duplicate${importResult.skipped_duplicates !== 1 ? 's' : ''}`}.
              </p>
            </div>
            <button
              className="btn-primary"
              onClick={() =>
                navigate(`/transactions?account_id=${selectedAccountId}&sort_dir=desc`)
              }
            >
              View transactions
            </button>
          </div>
        )}
      </div>
    </Layout>
  )
}
