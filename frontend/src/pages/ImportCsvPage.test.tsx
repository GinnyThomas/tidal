// pages/ImportCsvPage.test.tsx
//
// Integration tests for the CSV import multi-step flow.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import axios from 'axios'
import ImportCsvPage from './ImportCsvPage'

// Mock axios
vi.mock('axios')
const mockedAxios = vi.mocked(axios, true)

// Mock navigate
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

// Mock papaparse
vi.mock('papaparse', () => ({
  default: {
    parse: vi.fn((text: string, opts: { header?: boolean }) => {
      if (opts?.header) {
        return {
          data: [
            { 'Transaction ID': 'tx_001', Date: '01/04/2026', Time: '10:00', Type: 'Card payment',
              Name: 'Tesco', Emoji: '', Category: 'Groceries', Amount: '-42.50', Currency: 'GBP',
              'Local amount': '-42.50', 'Local currency': 'GBP', 'Notes and #tags': 'shop',
              Address: '', Receipt: '', Description: 'shop', 'Category split': '', 'Money Out': '-42.50', 'Money In': '' },
          ],
          meta: {
            fields: ['Transaction ID', 'Date', 'Time', 'Type', 'Name', 'Emoji', 'Category',
              'Amount', 'Currency', 'Local amount', 'Local currency', 'Notes and #tags',
              'Address', 'Receipt', 'Description', 'Category split', 'Money Out', 'Money In'],
          },
          errors: [],
        }
      }
      return { data: [], meta: { fields: [] }, errors: [] }
    }),
  },
}))

// Mock xlsx — default stub; individual tests can override with mockReturnValueOnce
vi.mock('xlsx', () => ({
  read: vi.fn(),
  utils: { sheet_to_json: vi.fn() },
}))

const ACCOUNTS = [
  { id: 'acc-123', name: 'Monzo', currency: 'GBP' },
  { id: 'acc-456', name: 'Virgin', currency: 'GBP' },
]

const CATEGORIES = [
  { id: 'cat-groceries', name: 'Groceries', parent_category_id: null },
  { id: 'cat-transport', name: 'Transport', parent_category_id: null },
]

function mockAccountsResponse() {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.includes('/api/v1/accounts')) return Promise.resolve({ data: ACCOUNTS })
    if (url.includes('/api/v1/categories')) return Promise.resolve({ data: CATEGORIES })
    if (url.includes('/api/v1/csv-mappings')) return Promise.reject({ response: { status: 404 } })
    if (url.includes('/api/v1/transactions')) return Promise.resolve({ data: { items: [] } })
    return Promise.reject(new Error('unexpected'))
  })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ImportCsvPage />
    </MemoryRouter>,
  )
}

describe('ImportCsvPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Simulate a logged-in user — the page reads this to build Authorization headers
    localStorage.setItem('access_token', 'fake-token')
    mockAccountsResponse()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('renders the account dropdown after loading', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Monzo (GBP)')).toBeInTheDocument()
    })
  })

  it('renders the file input', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByLabelText(/CSV or XLSX file/i)).toBeInTheDocument()
    })
  })

  it('shows supported banks hint', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/Auto-detected banks: Monzo, Virgin Money/)).toBeInTheDocument()
    })
  })

  // ── Auth header assertions ──────────────────────────────────────────────────

  it('fetches accounts with Authorization header', async () => {
    renderPage()
    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/accounts'),
        expect.objectContaining({ headers: { Authorization: 'Bearer fake-token' } }),
      )
    })
  })

  it('fetches transactions (dedup check) with Authorization header', async () => {
    renderPage()
    await waitFor(() => screen.getByText('Monzo (GBP)'))

    const fileInput = screen.getByLabelText(/CSV or XLSX file/i)
    const csvContent = 'Transaction ID,Date,...'
    const file = new File([csvContent], 'monzo.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csvContent) })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/transactions'),
        expect.objectContaining({ headers: { Authorization: 'Bearer fake-token' } }),
      )
    }, { timeout: 3000 })
  })

  it('sends import POST with Authorization header', async () => {
    mockedAxios.post = vi.fn().mockResolvedValue({ data: { created: 1, skipped_duplicates: 0, skipped_rows: [] } })

    renderPage()
    await waitFor(() => screen.getByText('Monzo (GBP)'))

    const fileInput = screen.getByLabelText(/CSV or XLSX file/i)
    const csvContent = 'Transaction ID,Date,...'
    const file = new File([csvContent], 'monzo.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csvContent) })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => screen.getByRole('button', { name: /Import \d+ transaction/i }), { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: /Import \d+ transaction/i }))

    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/transactions/import'),
        expect.any(Object),
        expect.objectContaining({ headers: { Authorization: 'Bearer fake-token' } }),
      )
    })
  })

  it('sends saved-mapping GET with Authorization header', async () => {
    // Use a file that doesn't match a template so we hit the mapping-GET path
    const Papa = await import('papaparse')
    vi.mocked(Papa.default.parse).mockReturnValueOnce({
      data: [{ Date: '15/01/2026', Amount: '-42.50', Name: 'Tesco' }],
      meta: { fields: ['Date', 'Amount', 'Name'] },
      errors: [],
    } as any)

    mockedAxios.get.mockImplementation((url: string, config?: object) => {
      if (url.includes('/api/v1/accounts')) return Promise.resolve({ data: ACCOUNTS })
      if (url.includes('/api/v1/csv-mappings')) return Promise.reject({ response: { status: 404 } })
      if (url.includes('/api/v1/transactions')) return Promise.resolve({ data: { items: [], total: 0 } })
      return Promise.reject(new Error('unexpected'))
    })

    renderPage()
    await waitFor(() => screen.getByText('Monzo (GBP)'))

    const fileInput = screen.getByLabelText(/CSV or XLSX file/i)
    const file = new File(['Date,Amount,Name\n15/01/2026,-42.50,Tesco'], 'bank.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve('Date,Amount,Name\n15/01/2026,-42.50,Tesco') })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/csv-mappings/'),
        expect.objectContaining({ headers: { Authorization: 'Bearer fake-token' } }),
      )
    }, { timeout: 3000 })
  })

  // ───────────────────────────────────────────────────────────────────────────

  it('detects Monzo template and advances to review after file upload', async () => {
    renderPage()
    await waitFor(() => screen.getByText('Monzo (GBP)'))

    // Simulate file selection — triggers handleFileChange
    const fileInput = screen.getByLabelText(/CSV or XLSX file/i)
    const csvContent = 'Transaction ID,Date,...'
    const file = new File([csvContent], 'monzo.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csvContent) })

    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/Detected:/)).toBeInTheDocument()
      expect(screen.getByText(/Monzo/)).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('shows Import button on the review step with correct count', async () => {
    renderPage()
    await waitFor(() => screen.getByText('Monzo (GBP)'))

    const fileInput = screen.getByLabelText(/CSV or XLSX file/i)
    const csvContent = 'Transaction ID,Date,...'
    const file = new File([csvContent], 'monzo.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csvContent) })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Import \d+ transaction/i })).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('calls POST /transactions/import on confirm', async () => {
    mockedAxios.post = vi.fn().mockResolvedValue({ data: { created: 1, skipped_duplicates: 0, skipped_rows: [] } })

    renderPage()
    await waitFor(() => screen.getByText('Monzo (GBP)'))

    const fileInput = screen.getByLabelText(/CSV or XLSX file/i)
    const csvContent = 'Transaction ID,Date,...'
    const file = new File([csvContent], 'monzo.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csvContent) })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => screen.getByRole('button', { name: /Import/i }), { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: /Import \d+ transaction/i }))

    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/transactions/import'),
        expect.objectContaining({ account_id: 'acc-123' }),
        expect.objectContaining({ headers: { Authorization: 'Bearer fake-token' } }),
      )
    })
  })

  it('shows success message on done step', async () => {
    mockedAxios.post = vi.fn().mockResolvedValue({ data: { created: 1, skipped_duplicates: 0, skipped_rows: [] } })

    renderPage()
    await waitFor(() => screen.getByText('Monzo (GBP)'))

    const fileInput = screen.getByLabelText(/CSV or XLSX file/i)
    const csvContent = 'Transaction ID,Date,...'
    const file = new File([csvContent], 'monzo.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csvContent) })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => screen.getByRole('button', { name: /Import \d+ transaction/i }), { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: /Import \d+ transaction/i }))

    await waitFor(() => {
      expect(screen.getByText(/Imported 1 transaction/)).toBeInTheDocument()
    })
  })

  it('saved mapping is fetched and applied when a mapping exists', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('/api/v1/accounts')) return Promise.resolve({ data: ACCOUNTS })
      if (url.includes('/api/v1/csv-mappings')) return Promise.resolve({
        data: {
          mapping_json: {
            dateColumn: 'Date', dateFormat: 'DD/MM/YYYY',
            amountMode: 'single', amountColumn: 'Amount',
            debitColumn: '', creditColumn: '',
            payeeColumn: 'Name', notesColumn: '', externalIdColumn: '',
            decimalSeparator: '.',
          },
        },
      })
      if (url.includes('/api/v1/transactions')) return Promise.resolve({ data: { items: [] } })
      return Promise.reject(new Error('unexpected'))
    })

    renderPage()
    await waitFor(() => screen.getByText('Monzo (GBP)'))

    // With a saved mapping, should skip to review
    const fileInput = screen.getByLabelText(/CSV or XLSX file/i)
    const csvContent = 'Date,Amount,Name\n15/01/2026,-42.50,Tesco'
    const file = new File([csvContent], 'unknown.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csvContent) })

    // Override papaparse to return unknown headers so template detection fails
    const Papa = await import('papaparse')
    vi.mocked(Papa.default.parse).mockReturnValueOnce({
      data: [{ Date: '15/01/2026', Amount: '-42.50', Name: 'Tesco' }],
      meta: { fields: ['Date', 'Amount', 'Name'] },
      errors: [],
    } as any)

    fireEvent.change(fileInput, { target: { files: [file] } })

    // Should reach review step (saved mapping was applied)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Import/i })).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('shows manual mapping form when no template and no saved mapping', async () => {
    // Override papaparse to return completely unknown headers
    const Papa = await import('papaparse')
    vi.mocked(Papa.default.parse).mockReturnValueOnce({
      data: [{ FooCol: 'x', BarCol: 'y', BazCol: 'z' }],
      meta: { fields: ['FooCol', 'BarCol', 'BazCol'] },
      errors: [],
    } as any)

    renderPage()
    await waitFor(() => screen.getByText('Monzo (GBP)'))

    const fileInput = screen.getByLabelText(/CSV or XLSX file/i)
    const file = new File(['FooCol,BarCol,BazCol\nx,y,z'], 'unknown.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve('FooCol,BarCol,BazCol\nx,y,z') })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/Map columns/i)).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('shows accounts fetch error when /accounts call fails', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('/api/v1/accounts')) return Promise.reject(new Error('network'))
      return Promise.reject(new Error('unexpected'))
    })

    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/Failed to load accounts/i)).toBeInTheDocument()
    })
  })

  it('shows dedup warning and keeps all rows included when duplicate-check fetch fails', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('/api/v1/accounts')) return Promise.resolve({ data: ACCOUNTS })
      if (url.includes('/api/v1/csv-mappings')) return Promise.reject({ response: { status: 404 } })
      if (url.includes('/api/v1/transactions')) return Promise.reject(new Error('network'))
      return Promise.reject(new Error('unexpected'))
    })

    renderPage()
    await waitFor(() => screen.getByText('Monzo (GBP)'))

    const fileInput = screen.getByLabelText(/CSV or XLSX file/i)
    const csvContent = 'Transaction ID,Date,...'
    const file = new File([csvContent], 'monzo.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csvContent) })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/Could not check for duplicates/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    // All rows should be included (Import button enabled)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Import \d+ transaction/i })).not.toBeDisabled()
    }, { timeout: 3000 })
  })

  it('shows error message when import API call fails', async () => {
    mockedAxios.post = vi.fn().mockRejectedValue(new Error('server error'))

    renderPage()
    await waitFor(() => screen.getByText('Monzo (GBP)'))

    const fileInput = screen.getByLabelText(/CSV or XLSX file/i)
    const csvContent = 'Transaction ID,Date,...'
    const file = new File([csvContent], 'monzo.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csvContent) })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => screen.getByRole('button', { name: /Import \d+ transaction/i }), { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: /Import \d+ transaction/i }))

    await waitFor(() => {
      expect(screen.getByText(/Import failed/i)).toBeInTheDocument()
    })
  })

  it('navigates back to pick step when Back button clicked on review step', async () => {
    renderPage()
    await waitFor(() => screen.getByText('Monzo (GBP)'))

    const fileInput = screen.getByLabelText(/CSV or XLSX file/i)
    const csvContent = 'Transaction ID,Date,...'
    const file = new File([csvContent], 'monzo.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csvContent) })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => screen.getByRole('button', { name: /Import \d+ transaction/i }), { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: /Back/i }))

    await waitFor(() => {
      expect(screen.getByLabelText(/CSV or XLSX file/i)).toBeInTheDocument()
    })
  })

  it('parses XLSX file using SheetJS and advances to review', async () => {
    const XLSX = await import('xlsx')
    vi.mocked(XLSX.read).mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    } as any)
    // Header row (index 2) must contain a keyword like "date" or "amount"
    // so it passes the sanity check added in Fix 7.
    vi.mocked(XLSX.utils.sheet_to_json).mockReturnValue([
      // metadata rows with fewer cells
      ['Banco Santander'],
      ['IBAN', 'ES12345'],
      // header row — 5 cells (densest + contains "date" keyword)
      ['Transaction date', 'Value date', 'Description', 'Amount', 'Balance'],
      // data rows
      ['07/07/2026', '07/07/2026', 'TESCO', '\u221231,95', '1.234,56'],
    ] as any)

    renderPage()
    await waitFor(() => screen.getByText('Monzo (GBP)'))

    const fileInput = screen.getByLabelText(/CSV or XLSX file/i)
    const file = new File(['dummy'], 'santander.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(new ArrayBuffer(0)) })
    fireEvent.change(fileInput, { target: { files: [file] } })

    // Template detected (santander_es) → advances to review
    await waitFor(() => {
      expect(screen.getByText(/Detected:/)).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('shows parse-failure warning when template returns errors for some rows', async () => {
    // Override papaparse to return a row that the Monzo template will fail to parse
    const Papa = await import('papaparse')
    vi.mocked(Papa.default.parse).mockReturnValueOnce({
      data: [
        // Valid Monzo row
        { 'Transaction ID': 'tx_001', 'Date': '01/04/2026', 'Amount': '-42.50', 'Name': 'Tesco',
          'Notes and #tags': '', 'Currency': 'GBP', 'Local amount': '', 'Local currency': '' },
        // Invalid row — bad date
        { 'Transaction ID': 'tx_002', 'Date': 'NOT-A-DATE', 'Amount': '-10.00', 'Name': 'Shop',
          'Notes and #tags': '', 'Currency': 'GBP', 'Local amount': '', 'Local currency': '' },
      ],
      meta: {
        fields: ['Transaction ID', 'Date', 'Time', 'Type', 'Name', 'Emoji', 'Category',
          'Amount', 'Currency', 'Local amount', 'Local currency', 'Notes and #tags',
          'Address', 'Receipt', 'Description', 'Category split', 'Money Out', 'Money In'],
      },
      errors: [],
    } as any)

    renderPage()
    await waitFor(() => screen.getByText('Monzo (GBP)'))

    const fileInput = screen.getByLabelText(/CSV or XLSX file/i)
    const csvContent = 'Transaction ID,Date,...'
    const file = new File([csvContent], 'monzo.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csvContent) })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/could not be parsed/i)).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('excludes a row with a field-count mismatch instead of blocking the whole import', async () => {
    // Real-world case: a Virgin Money export had a duplicated city name in one
    // row, shifting every column after it by one — papaparse reports this as
    // a FieldMismatch error for that specific row (row index 1 = "Shop").
    // The whole file (528 other valid rows) must still import.
    const Papa = await import('papaparse')
    vi.mocked(Papa.default.parse).mockReturnValueOnce({
      data: [
        { 'Transaction ID': 'tx_001', 'Date': '01/04/2026', 'Amount': '-42.50', 'Name': 'Tesco',
          'Notes and #tags': '', 'Currency': 'GBP', 'Local amount': '', 'Local currency': '' },
        { 'Transaction ID': 'tx_002', 'Date': '02/04/2026', 'Amount': '-10.00', 'Name': 'Shop',
          'Notes and #tags': '', 'Currency': 'GBP', 'Local amount': '', 'Local currency': '',
          __parsed_extra: ['extra-value'] },
      ],
      meta: {
        fields: ['Transaction ID', 'Date', 'Time', 'Type', 'Name', 'Emoji', 'Category',
          'Amount', 'Currency', 'Local amount', 'Local currency', 'Notes and #tags',
          'Address', 'Receipt', 'Description', 'Category split', 'Money Out', 'Money In'],
      },
      errors: [
        { type: 'FieldMismatch', code: 'TooManyFields', message: 'Too many fields: expected 18 fields but parsed 19', row: 1 },
      ],
    } as any)

    renderPage()
    await waitFor(() => screen.getByText('Monzo (GBP)'))

    const fileInput = screen.getByLabelText(/CSV or XLSX file/i)
    const csvContent = 'Transaction ID,Date,...'
    const file = new File([csvContent], 'monzo.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csvContent) })
    fireEvent.change(fileInput, { target: { files: [file] } })

    // Not treated as a fatal file-level error
    await waitFor(() => {
      expect(screen.queryByText(/CSV parse error/i)).not.toBeInTheDocument()
    })

    // Reaches the review step with only the one unaffected row counted
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Import 1 transaction/i })).toBeInTheDocument()
    }, { timeout: 3000 })

    // The mismatched row is reported, not silently dropped
    expect(screen.getByText(/could not be parsed/i)).toBeInTheDocument()
  })

  it('reports the correct original row number for a parse failure after an excluded mismatch row', async () => {
    // .filter() reindexes the array — if a genuine parse failure's row
    // number were computed from its position in the post-filter array
    // instead of its original file line, excluding an earlier row would
    // make every later failure misreport itself as one line earlier than
    // it actually is. Layout: row0 valid, row1 FieldMismatch (excluded),
    // row2 valid (no failure — just there to shift the array position),
    // row3 has a bad date (a genuine, later parse failure).
    const Papa = await import('papaparse')
    vi.mocked(Papa.default.parse).mockReturnValueOnce({
      data: [
        { 'Transaction ID': 'tx_001', 'Date': '01/04/2026', 'Amount': '-42.50', 'Name': 'Tesco',
          'Notes and #tags': '', 'Currency': 'GBP', 'Local amount': '', 'Local currency': '' },
        { 'Transaction ID': 'tx_002', 'Date': '02/04/2026', 'Amount': '-10.00', 'Name': 'Shop',
          'Notes and #tags': '', 'Currency': 'GBP', 'Local amount': '', 'Local currency': '',
          __parsed_extra: ['extra-value'] },
        { 'Transaction ID': 'tx_003', 'Date': '03/04/2026', 'Amount': '-15.00', 'Name': 'Garage',
          'Notes and #tags': '', 'Currency': 'GBP', 'Local amount': '', 'Local currency': '' },
        { 'Transaction ID': 'tx_004', 'Date': 'NOT-A-DATE', 'Amount': '-5.00', 'Name': 'BadDate',
          'Notes and #tags': '', 'Currency': 'GBP', 'Local amount': '', 'Local currency': '' },
      ],
      meta: {
        fields: ['Transaction ID', 'Date', 'Time', 'Type', 'Name', 'Emoji', 'Category',
          'Amount', 'Currency', 'Local amount', 'Local currency', 'Notes and #tags',
          'Address', 'Receipt', 'Description', 'Category split', 'Money Out', 'Money In'],
      },
      errors: [
        { type: 'FieldMismatch', code: 'TooManyFields', message: 'Too many fields: expected 18 fields but parsed 19', row: 1 },
      ],
    } as any)

    renderPage()
    await waitFor(() => screen.getByText('Monzo (GBP)'))

    const fileInput = screen.getByLabelText(/CSV or XLSX file/i)
    const csvContent = 'Transaction ID,Date,...'
    const file = new File([csvContent], 'monzo.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csvContent) })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => screen.getByText(/could not be parsed/i), { timeout: 3000 })
    fireEvent.click(screen.getByText(/Show details/i))

    // row3 (0-based) is file line 5 (header=1, row0=2, row1=3, row2=4, row3=5).
    // Before the fix, its post-filter array position (2, since only row1 was
    // excluded) would incorrectly compute line 4 instead.
    const badDateRow = (await screen.findAllByRole('row')).find(r =>
      within(r).queryAllByText(/NOT-A-DATE/i).length > 0,
    )
    expect(badDateRow).toBeTruthy()
    expect(within(badDateRow!).getByText('5')).toBeInTheDocument()
  })

  it('still blocks the whole import for a non-FieldMismatch parse error', async () => {
    const Papa = await import('papaparse')
    vi.mocked(Papa.default.parse).mockReturnValueOnce({
      data: [],
      meta: { fields: [] },
      errors: [
        { type: 'Delimiter', code: 'UndetectableDelimiter', message: 'Unable to auto-detect delimiting character; defaulted to comma.' },
      ],
    } as any)

    renderPage()
    await waitFor(() => screen.getByText('Monzo (GBP)'))

    const fileInput = screen.getByLabelText(/CSV or XLSX file/i)
    const csvContent = 'garbage'
    const file = new File([csvContent], 'bad.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csvContent) })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/CSV parse error/i)).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('shows server-side skipped_rows on success screen', async () => {
    mockedAxios.post = vi.fn().mockResolvedValue({
      data: {
        created: 0,
        skipped_duplicates: 1,
        skipped_rows: [{ row_index: 0, reason: 'Duplicate transaction (hash match)' }],
      },
    })

    renderPage()
    await waitFor(() => screen.getByText('Monzo (GBP)'))

    const fileInput = screen.getByLabelText(/CSV or XLSX file/i)
    const csvContent = 'Transaction ID,Date,...'
    const file = new File([csvContent], 'monzo.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csvContent) })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => screen.getByRole('button', { name: /Import \d+ transaction/i }), { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: /Import \d+ transaction/i }))

    await waitFor(() => {
      expect(screen.getByText(/Duplicate transaction/i)).toBeInTheDocument()
    })
  })

  it('saves mapping when user checks save box and submits mapping form', async () => {
    mockedAxios.post = vi.fn().mockResolvedValue({ data: { created: 0, skipped_duplicates: 0 } })

    const Papa = await import('papaparse')
    vi.mocked(Papa.default.parse).mockReturnValueOnce({
      data: [{ Date: '15/01/2026', Amount: '-42.50', Merchant: 'Tesco' }],
      meta: { fields: ['Date', 'Amount', 'Merchant'] },
      errors: [],
    } as any)

    renderPage()
    await waitFor(() => screen.getByText('Monzo (GBP)'))

    const fileInput = screen.getByLabelText(/CSV or XLSX file/i)
    const file = new File(['Date,Amount,Merchant\n15/01/2026,-42.50,Tesco'], 'bank.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve('Date,Amount,Merchant\n15/01/2026,-42.50,Tesco') })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => screen.getByText(/Map columns/i), { timeout: 3000 })

    // save checkbox should be checked by default
    const saveBtn = screen.getByRole('button', { name: /Save & Continue/i })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/csv-mappings'),
        expect.objectContaining({ account_id: 'acc-123' }),
        expect.objectContaining({ headers: { Authorization: 'Bearer fake-token' } }),
      )
    }, { timeout: 3000 })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Category assignment during review
  // ───────────────────────────────────────────────────────────────────────────

  async function uploadMonzoFileAndReachReview() {
    renderPage()
    await waitFor(() => screen.getByText('Monzo (GBP)'))

    const fileInput = screen.getByLabelText(/CSV or XLSX file/i)
    const csvContent = 'Transaction ID,Date,...'
    const file = new File([csvContent], 'monzo.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csvContent) })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => screen.getByRole('button', { name: /Import \d+ transaction/i }), { timeout: 3000 })
  }

  it('fetches categories with Authorization header', async () => {
    renderPage()
    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/categories'),
        expect.objectContaining({ headers: { Authorization: 'Bearer fake-token' } }),
      )
    })
  })

  it('shows a category dropdown for each row on the review step', async () => {
    await uploadMonzoFileAndReachReview()
    expect(screen.getByLabelText(/Category for row 1/i)).toBeInTheDocument()
  })

  it('includes the picked category_id in the import payload', async () => {
    mockedAxios.post = vi.fn().mockResolvedValue({ data: { created: 1, skipped_duplicates: 0, skipped_rows: [] } })
    await uploadMonzoFileAndReachReview()

    fireEvent.change(screen.getByLabelText(/Category for row 1/i), { target: { value: 'cat-groceries' } })
    fireEvent.click(screen.getByRole('button', { name: /Import \d+ transaction/i }))

    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/transactions/import'),
        expect.objectContaining({
          transactions: [expect.objectContaining({ category_id: 'cat-groceries' })],
        }),
        expect.any(Object),
      )
    })
  })

  it('sends null category_id for rows left uncategorised', async () => {
    mockedAxios.post = vi.fn().mockResolvedValue({ data: { created: 1, skipped_duplicates: 0, skipped_rows: [] } })
    await uploadMonzoFileAndReachReview()

    fireEvent.click(screen.getByRole('button', { name: /Import \d+ transaction/i }))

    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/transactions/import'),
        expect.objectContaining({
          transactions: [expect.objectContaining({ category_id: null })],
        }),
        expect.any(Object),
      )
    })
  })

  it('bulk-assigns a category to all included rows via "Apply to selected"', async () => {
    mockedAxios.post = vi.fn().mockResolvedValue({ data: { created: 1, skipped_duplicates: 0, skipped_rows: [] } })
    await uploadMonzoFileAndReachReview()

    fireEvent.change(screen.getByLabelText(/Bulk assign category/i), { target: { value: 'cat-transport' } })
    fireEvent.click(screen.getByRole('button', { name: /Apply to \d+ selected/i }))

    expect(screen.getByLabelText(/Category for row 1/i)).toHaveValue('cat-transport')

    fireEvent.click(screen.getByRole('button', { name: /Import \d+ transaction/i }))
    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/transactions/import'),
        expect.objectContaining({
          transactions: [expect.objectContaining({ category_id: 'cat-transport' })],
        }),
        expect.any(Object),
      )
    })
  })
})
