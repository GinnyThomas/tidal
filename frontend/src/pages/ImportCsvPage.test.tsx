// pages/ImportCsvPage.test.tsx
//
// Integration tests for the CSV import multi-step flow.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

function mockAccountsResponse() {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.includes('/api/v1/accounts')) return Promise.resolve({ data: ACCOUNTS })
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
    mockAccountsResponse()
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
      expect(screen.getByText(/Monzo, Virgin Money/)).toBeInTheDocument()
    })
  })

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
    mockedAxios.post = vi.fn().mockResolvedValue({ data: { created: 1, skipped_duplicates: 0 } })

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
      )
    })
  })

  it('shows success message on done step', async () => {
    mockedAxios.post = vi.fn().mockResolvedValue({ data: { created: 1, skipped_duplicates: 0 } })

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
    vi.mocked(XLSX.utils.sheet_to_json).mockReturnValue([
      // metadata rows with fewer cells
      ['Banco Santander'],
      ['IBAN', 'ES12345'],
      // header row — 5 cells (most in sheet)
      ['Transaction date', 'Value date', 'Description', 'Amount', 'Balance'],
      // data rows
      ['07/07/2026', '07/07/2026', 'TESCO', '−31,95', '1.234,56'],
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
      )
    }, { timeout: 3000 })
  })
})
