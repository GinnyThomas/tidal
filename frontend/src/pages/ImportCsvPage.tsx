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
import { detectTemplate } from '../lib/csvTemplates'
import type { CsvTemplate, ParsedRow, ParseFailedRow } from '../lib/csvTemplates'
import { parseDate, parseAmount, clampPayee } from '../lib/csvParsing'
import { computeDedupHash } from '../lib/dedupHash'
import { buildCategoryOptions } from '../lib/categories'
import { getApiBaseUrl } from '../lib/api'

type Account = { id: string; name: string; currency: string }
type Category = { id: string; name: string; parent_category_id: string | null }

type ClassifiedRow = ParsedRow & {
  status: 'new' | 'definite_duplicate' | 'possible_duplicate'
  included: boolean
  // '' means uncategorised — assigned during the review step (per-row or
  // via "bulk assign") so the user doesn't have to edit every row afterwards.
  categoryId: string
}

type Step = 'pick' | 'mapping' | 'review' | 'done'

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('access_token')}` }
}

// Apply a saved MappingConfig to raw rows, collecting both successes and failures.
// Uses the shared parseDate/parseAmount from csvParsing.ts — the same functions
// that CsvMappingForm uses for its live preview — so both paths are always in sync.
//
// originalIndexes[i] gives the row-index `rows[i]` had in the original parsed
// file, BEFORE any FieldMismatch rows were filtered out (see handleFileChange).
// Using `rows`' own post-filter position for rowNumber would silently misreport
// which line a later, unrelated parse failure is on — .filter() reindexes the
// array, so if row 2 was excluded, the row that used to be #5 shifts to
// position 3 and would incorrectly report itself as row 4.
function applyMappingConfig(
  rows: Record<string, string>[],
  config: MappingConfig,
  originalIndexes: number[],
): { parsed: ParsedRow[]; failed: ParseFailedRow[] } {
  const parsed: ParsedRow[] = []
  const failed: ParseFailedRow[] = []
  const sep = config.decimalSeparator

  function resolveAmount(row: Record<string, string>): { amount: string } | { error: string } {
    if (config.amountMode === 'single') {
      return parseAmount(row[config.amountColumn] ?? '', sep)
    }
    // debit_credit mode
    const debitRaw = row[config.debitColumn] ?? ''
    const creditRaw = row[config.creditColumn] ?? ''
    const debitResult = debitRaw ? parseAmount(debitRaw, sep) : null
    const creditResult = creditRaw ? parseAmount(creditRaw, sep) : null
    const debit = debitResult && !('error' in debitResult) ? parseFloat(debitResult.amount) : null
    const credit = creditResult && !('error' in creditResult) ? parseFloat(creditResult.amount) : null
    if (debit !== null && debit !== 0) return { amount: (-Math.abs(debit)).toFixed(2) }
    if (credit !== null && credit !== 0) return { amount: Math.abs(credit).toFixed(2) }
    return { amount: '0.00' }
  }

  rows.forEach((row, i) => {
    const dateRaw = row[config.dateColumn]?.trim() ?? ''
    // Treat truly blank rows as silent skips
    if (!dateRaw && !(row[config.amountColumn] ?? '').trim()) return

    const rowNumber = originalIndexes[i] + 2

    const dateResult = parseDate(dateRaw, config.dateFormat)
    if ('error' in dateResult) {
      failed.push({ rowNumber, rawRow: row, reason: dateResult.error })
      return
    }

    const amountResult = resolveAmount(row)
    if ('error' in amountResult) {
      failed.push({ rowNumber, rawRow: row, reason: amountResult.error })
      return
    }

    parsed.push({
      date: dateResult.date,
      amount: amountResult.amount,
      payee: row[config.payeeColumn]?.trim() || '',
      notes: config.notesColumn ? row[config.notesColumn]?.trim() || undefined : undefined,
      externalId: config.externalIdColumn ? row[config.externalIdColumn]?.trim() || undefined : undefined,
    })
  })

  return { parsed, failed }
}

// Applied to every ParsedRow — regardless of which bank template or mapping
// path produced it — right after parsing and before the dedup hash is
// computed. See clampPayee's doc comment: the backend rejects the whole
// import batch if any single row's payee exceeds 100 chars, so this has to
// run before runDedup, not just before the final submit, or the hash the
// user reviews on-screen would differ from the one actually stored.
function clampParsedRows(rows: ParsedRow[]): ParsedRow[] {
  return rows.map(r => {
    const { payee, notes } = clampPayee(r.payee, r.notes)
    return { ...r, payee, notes }
  })
}

export default function ImportCsvPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('pick')

  // Step 1 state
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([])
  // rawRows[i]'s row number in the original file — see applyMappingConfig's
  // doc comment. Needed in state (not just a local var) because the manual
  // mapping step (handleMappingSave) runs in a later render.
  const [rawRowOriginalIndexes, setRawRowOriginalIndexes] = useState<number[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [detectedTemplate, setDetectedTemplate] = useState<CsvTemplate | null>(null)
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [fileLoading, setFileLoading] = useState(false)

  // Step 1 error state
  const [accountsError, setAccountsError] = useState<string | null>(null)

  // Step 3 state
  const [parseFailures, setParseFailures] = useState<ParseFailedRow[]>([])
  // FieldMismatch failures from papaparse (see handleFileChange) — kept in
  // state, not just a local var, because the manual-mapping step happens in
  // a later render (handleMappingSave) and still needs to report them.
  const [csvMismatchFailures, setCsvMismatchFailures] = useState<ParseFailedRow[]>([])
  const [failuresExpanded, setFailuresExpanded] = useState(false)
  const [classifiedRows, setClassifiedRows] = useState<ClassifiedRow[]>([])
  const [dedupLoading, setDedupLoading] = useState(false)
  const [dedupError, setDedupError] = useState<string | null>(null)
  const [bulkCategoryId, setBulkCategoryId] = useState('')

  // Step 4 state
  const [importResult, setImportResult] = useState<{
    created: number
    skipped_duplicates: number
    skipped_rows: { row_index: number; reason: string }[]
  } | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const selectedAccount = accounts.find(a => a.id === selectedAccountId)

  useEffect(() => {
    axios
      .get(`${getApiBaseUrl()}/api/v1/accounts`, { headers: authHeaders() })
      .then(r => {
        setAccounts(r.data)
        if (r.data.length > 0) setSelectedAccountId(r.data[0].id)
      })
      .catch(() => setAccountsError('Failed to load accounts. Please refresh the page.'))
  }, [])

  // Categories power the (optional) per-row and bulk category assignment on
  // the review step. Failure is non-critical — import still works without
  // categorisation, same as the category filter on TransactionsPage.
  useEffect(() => {
    axios
      .get(`${getApiBaseUrl()}/api/v1/categories`, { headers: authHeaders() })
      .then(r => setCategories(r.data))
      .catch(() => {})
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
      let mismatchFailures: ParseFailedRow[] = []
      // rows[i]'s row number in the original parsed file — identity unless
      // the CSV branch below excludes FieldMismatch rows, which shifts every
      // later row's array position without changing its real file line.
      let rowOriginalIndexes: number[] = []

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
        // Sanity check: the candidate row should contain at least one word that
        // looks like a column header (date/amount/description etc). This guards
        // against accidentally picking a dense metadata row instead of the real headers.
        const HEADER_KEYWORDS = [
          'date', 'amount', 'payee', 'description', 'debit', 'credit',
          'fecha', 'importe', 'concepto', 'transaction', 'memo', 'balance',
        ]
        const candidateRow = allRows[headerRowIndex]
        const hasHeaderKeyword = candidateRow.some(c =>
          c !== null &&
          HEADER_KEYWORDS.some(kw => String(c).trim().toLowerCase().includes(kw)),
        )
        if (!hasHeaderKeyword) {
          setFileError('Could not identify the header row in the XLSX file.')
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
        // No rows are excluded on this path — array position already matches
        // the original row order.
        rowOriginalIndexes = rows.map((_, i) => i)
      } else {
        // Parse CSV with papaparse
        const text = await file.text()
        const result = Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
        })

        // FieldMismatch (papaparse's TooManyFields/TooFewFields) means one
        // specific row had a different column count than the header —
        // usually an unescaped comma, or a bank export glitch (seen for
        // real: Virgin Money duplicated a city name in one row, shifting
        // every column after it by one). Using that row's positionally
        // mapped values would silently produce wrong data — e.g. a
        // reference number landing in the "debit or credit" column — rather
        // than a visible error, so these specific rows are excluded here and
        // reported as parse failures instead of blocking the whole file.
        // Any other error (e.g. an undetectable delimiter) still aborts —
        // the whole file is unreliable at that point, not just one row.
        const otherErrors = result.errors.filter(err => err.type !== 'FieldMismatch')
        if (otherErrors.length > 0) {
          setFileError(`CSV parse error: ${otherErrors[0].message}`)
          return
        }

        const mismatchRowIndexes = new Set(
          result.errors.filter(err => err.type === 'FieldMismatch').map(err => err.row),
        )
        mismatchFailures = result.data
          .map((r, i) => ({ r, i }))
          .filter(({ i }) => mismatchRowIndexes.has(i))
          .map(({ r, i }) => ({
            rowNumber: i + 2,
            rawRow: r,
            reason: 'Row has a different number of columns than the header — likely an unescaped comma or a bank export glitch. Columns after the mismatch may be shifted, so this row was skipped; add it manually if needed.',
          }))

        // Carry each surviving row's original index through the filter —
        // .filter() reindexes the array, so rows[i] no longer corresponds to
        // file line i+2 once anything upstream of it was excluded.
        const indexedRows = result.data
          .map((r, i) => ({ r, i }))
          .filter(({ i }) => !mismatchRowIndexes.has(i))
        rows = indexedRows.map(({ r }) => r)
        rowOriginalIndexes = indexedRows.map(({ i }) => i)
        hdrs = result.meta.fields ?? []
      }

      setRawRows(rows)
      setRawRowOriginalIndexes(rowOriginalIndexes)
      setHeaders(hdrs)
      setCsvMismatchFailures(mismatchFailures)

      // Try to detect a template from the headers
      const tmpl = detectTemplate(hdrs)

      if (tmpl) {
        setDetectedTemplate(tmpl)
        // Collect parse results: successes, errors, and silently-skipped nulls.
        // `i` here is the ORIGINAL file row index, not the post-filter array
        // position — see rowOriginalIndexes' doc comment above.
        const parseResults = rows.map((r, i) => ({ i: rowOriginalIndexes[i], r, result: tmpl.parse(r) }))
        const parsed = clampParsedRows(
          parseResults
            .filter(({ result }) => result !== null && !('error' in result))
            .map(({ result }) => result as ParsedRow),
        )
        const failed: ParseFailedRow[] = parseResults
          .filter(({ result }) => result !== null && 'error' in result)
          .map(({ i, r, result }) => ({
            rowNumber: i + 2,
            rawRow: r,
            reason: (result as { error: string }).error,
          }))
        setParsedRows(parsed)
        setParseFailures([...mismatchFailures, ...failed])
        setFailuresExpanded(false)
        await runDedup(parsed, selectedAccountId)
        setStep('review')
      } else {
        // Check for a saved mapping
        try {
          const mappingResp = await axios.get(
            `${getApiBaseUrl()}/api/v1/csv-mappings/${selectedAccountId}`,
            { headers: authHeaders() },
          )
          const savedConfig: MappingConfig = mappingResp.data.mapping_json
          const { parsed: rawParsed, failed } = applyMappingConfig(rows, savedConfig, rowOriginalIndexes)
          const parsed = clampParsedRows(rawParsed)
          setParsedRows(parsed)
          setParseFailures([...mismatchFailures, ...failed])
          setFailuresExpanded(false)
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
          headers: authHeaders(),
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

      // Process rows sequentially so within-batch fuzzy matching can inspect
      // rows already classified in the current import (Fix 4).
      const classified: ClassifiedRow[] = []

      // Helper: fuzzy-match two rows (same date + amount, different normalised payee)
      function isFuzzyDup(
        candidate: { date: string; amount?: string; payee?: string | null },
        row: ParsedRow,
      ): boolean {
        if (candidate.date !== row.date) return false
        const candidateAmt = parseFloat(candidate.amount ?? '0').toFixed(2)
        const rowAmt = parseFloat(row.amount).toFixed(2)
        if (candidateAmt !== rowAmt) return false
        const candidatePayee = (candidate.payee ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
        const rowPayee = row.payee.trim().toLowerCase().replace(/\s+/g, ' ')
        return candidatePayee !== rowPayee
      }

      for (const row of rows) {
        // external_id dedup takes precedence
        if (row.externalId) {
          if (existingExtIds.has(row.externalId) || batchExtIds.has(row.externalId)) {
            batchExtIds.add(row.externalId)
            classified.push({ ...row, status: 'definite_duplicate', included: false, categoryId: '' })
            continue
          }
          batchExtIds.add(row.externalId)
        }

        const hash = await computeDedupHash(accountId, row.date, row.amount, row.payee)

        if (existingHashes.has(hash) || batchHashes.has(hash)) {
          batchHashes.add(hash)
          classified.push({ ...row, status: 'definite_duplicate', included: false, categoryId: '' })
          continue
        }
        batchHashes.add(hash)

        // Possible duplicate: same date + amount, different payee —
        // check against existing DB rows AND already-classified rows in this batch.
        const possibleDup =
          existing.some(t => isFuzzyDup(t, row)) ||
          classified.some(c => c.status !== 'definite_duplicate' && isFuzzyDup(c, row))

        if (possibleDup) {
          classified.push({ ...row, status: 'possible_duplicate', included: false, categoryId: '' })
          continue
        }

        classified.push({ ...row, status: 'new', included: true, categoryId: '' })
      }

      setClassifiedRows(classified)
    } catch {
      // If the duplicate-check fetch fails, let the user proceed but warn them.
      // Mark all rows as new so the import button is available.
      setDedupError(
        'Could not check for duplicates — please review carefully before importing.',
      )
      setClassifiedRows(rows.map(row => ({ ...row, status: 'new' as const, included: true, categoryId: '' })))
    } finally {
      setDedupLoading(false)
    }
  }

  function handleMappingSave(config: MappingConfig, saveForAccount: boolean) {
    const { parsed: rawParsed, failed } = applyMappingConfig(rawRows, config, rawRowOriginalIndexes)
    const parsed = clampParsedRows(rawParsed)
    setParsedRows(parsed)
    setParseFailures([...csvMismatchFailures, ...failed])
    setFailuresExpanded(false)

    if (saveForAccount && selectedAccountId) {
      axios
        .post(
          `${getApiBaseUrl()}/api/v1/csv-mappings`,
          { account_id: selectedAccountId, name: `Custom mapping`, mapping_json: config },
          { headers: authHeaders() },
        )
        .catch(err => console.warn('Failed to save mapping:', err))
    }

    runDedup(parsed, selectedAccountId).then(() => setStep('review'))
  }

  function toggleRow(index: number) {
    setClassifiedRows(prev =>
      prev.map((r, i) => i === index ? { ...r, included: !r.included } : r),
    )
  }

  function setRowCategory(index: number, categoryId: string) {
    setClassifiedRows(prev =>
      prev.map((r, i) => i === index ? { ...r, categoryId } : r),
    )
  }

  // Applies bulkCategoryId to every row currently checked for import — lets
  // the user categorise a whole batch (e.g. all "Tesco" rows) in one action
  // instead of picking a category on each row individually.
  function applyBulkCategory() {
    if (!bulkCategoryId) return
    setClassifiedRows(prev =>
      prev.map(r => r.included ? { ...r, categoryId: bulkCategoryId } : r),
    )
  }

  async function handleConfirmImport() {
    const included = classifiedRows.filter(r => r.included)
    if (included.length === 0) return

    setImporting(true)
    setImportError(null)
    try {
      const resp = await axios.post(
        `${getApiBaseUrl()}/api/v1/transactions/import`,
        {
          account_id: selectedAccountId,
          transactions: included.map(r => ({
            date: r.date,
            amount: r.amount,
            payee: r.payee,
            notes: r.notes,
            external_id: r.externalId,
            category_id: r.categoryId || null,
          })),
        },
        { headers: authHeaders() },
      )
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
              Auto-detected banks: Monzo, Virgin Money, Santander España (XLSX).
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

            {parseFailures.length > 0 && (
              <div className="rounded-lg bg-warning/10 border border-warning/30 px-4 py-3 space-y-2">
                <p className="text-sm text-warning font-medium">
                  ⚠ {parseFailures.length} of {parseFailures.length + parsedRows.length} row{parseFailures.length !== 1 ? 's' : ''} could not be parsed and will not be imported.
                </p>
                <button
                  className="text-xs text-ocean-400 underline"
                  onClick={() => setFailuresExpanded(e => !e)}
                >
                  {failuresExpanded ? 'Hide details' : 'Show details'}
                </button>
                {failuresExpanded && (
                  <div className="overflow-x-auto rounded border border-warning/20 max-h-48">
                    <table className="w-full text-xs text-ocean-300 min-w-[500px]">
                      <thead className="bg-ocean-700 sticky top-0">
                        <tr>
                          <th className="px-2 py-1 text-left w-16">Row #</th>
                          <th className="px-2 py-1 text-left">Reason</th>
                          <th className="px-2 py-1 text-left">Raw data</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parseFailures.map((f, i) => (
                          <tr key={i} className="border-t border-ocean-600">
                            <td className="px-2 py-1">{f.rowNumber}</td>
                            <td className="px-2 py-1 text-danger">{f.reason}</td>
                            <td className="px-2 py-1 font-mono truncate max-w-60">
                              {Object.values(f.rawRow).join(' | ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
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

                {categories.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <label htmlFor="bulkCategory" className="text-sm text-ocean-300">
                      Bulk assign category:
                    </label>
                    <select
                      id="bulkCategory"
                      value={bulkCategoryId}
                      onChange={e => setBulkCategoryId(e.target.value)}
                      className="input-base text-xs py-1"
                    >
                      <option value="">Select a category…</option>
                      {buildCategoryOptions(categories).map(opt => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn-secondary text-xs px-3 py-1"
                      onClick={applyBulkCategory}
                      disabled={!bulkCategoryId || includedCount === 0}
                    >
                      Apply to {includedCount} selected
                    </button>
                  </div>
                )}

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
                        <th className="px-2 py-2 text-left">Category</th>
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
                          <td className="px-2 py-1">
                            <select
                              value={row.categoryId}
                              onChange={e => setRowCategory(i, e.target.value)}
                              className="input-base text-xs py-1"
                              aria-label={`Category for row ${i + 1}`}
                              disabled={row.status === 'definite_duplicate'}
                            >
                              <option value="">No category</option>
                              {buildCategoryOptions(categories).map(opt => (
                                <option key={opt.id} value={opt.id}>{opt.label}</option>
                              ))}
                            </select>
                          </td>
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
            {(importResult.skipped_rows ?? []).length > 0 && (
              <div className="rounded border border-ocean-600 px-4 py-3">
                <p className="text-xs text-ocean-400 font-medium mb-2">
                  Server-side skips ({importResult.skipped_rows.length}):
                </p>
                <ul className="text-xs text-ocean-400 space-y-1 list-disc list-inside">
                  {(importResult.skipped_rows ?? []).map((s, i) => (
                    <li key={i}>Row {s.row_index + 1}: {s.reason}</li>
                  ))}
                </ul>
              </div>
            )}
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
