// pages/AnnualView.test.tsx
//
// Purpose: Tests for AnnualView — the annual budget spreadsheet.
//
// Test strategy:
//   Loading state, error state, empty state (no planned amounts across the year),
//   12 month column headers, category amounts, "—" for zero amounts,
//   and year navigation (prev/next year buttons).
//
// One axios.get call on mount: GET /api/v1/plan/{year}
// Returns an AnnualPlan: { year, months: MonthlyPlan[12] }

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import AnnualView from './AnnualView'
import { getApiBaseUrl } from '../lib/api'

vi.mock('axios')

// --- Factories ---

const makePlanRow = (overrides: object = {}) => ({
    category_id: 'cat-001',
    category_name: 'Bills',
    parent_category_id: null,
    planned: '100.00',
    actual: '0.00',
    remaining: '100.00',
    pending: '0.00',
    ...overrides,
})

// Build a full 12-month AnnualPlan.
// rowsByMonth is 0-indexed: { 0: [rows for Jan], 3: [rows for Apr], ... }
// Months not specified get empty rows.
function makeAnnualPlan(
    year = 2026,
    rowsByMonth: Record<number, ReturnType<typeof makePlanRow>[]> = {},
) {
    return {
        year,
        months: Array.from({ length: 12 }, (_, i) => ({
            year,
            month: i + 1,
            rows: rowsByMonth[i] ?? [],
            total_planned: (rowsByMonth[i] ?? [])
                .reduce((sum: number, r: ReturnType<typeof makePlanRow>) => sum + parseFloat(r.planned), 0)
                .toFixed(2),
            total_actual: '0.00',
            total_remaining: '0.00',
            total_pending: '0.00',
        })),
    }
}

describe('AnnualView', () => {
    beforeEach(() => {
        localStorage.setItem('access_token', 'fake-token')
    })

    afterEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    // =========================================================================
    // Render states
    // =========================================================================

    it('shows a loading indicator while the fetch is in progress', () => {
        // Never resolves — component stays in loading state
        vi.mocked(axios.get).mockReturnValueOnce(new Promise<never>(() => {}))

        render(<MemoryRouter><AnnualView /></MemoryRouter>)

        expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })

    it('shows an error message when the fetch fails', async () => {
        vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network error'))

        render(<MemoryRouter><AnnualView /></MemoryRouter>)

        expect(await screen.findByText(/could not load/i)).toBeInTheDocument()
    })

    it('shows an empty state when no categories have planned amounts', async () => {
        // All 12 months have empty rows → no active categories → empty state
        vi.mocked(axios.get).mockResolvedValueOnce({ data: makeAnnualPlan() })

        render(<MemoryRouter><AnnualView /></MemoryRouter>)

        expect(await screen.findByText(/no scheduled amounts/i)).toBeInTheDocument()
    })

    // =========================================================================
    // Table structure
    // =========================================================================

    it('renders all 12 month column headers (Jan through Dec)', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: makeAnnualPlan(2026, { 0: [makePlanRow()] }),
        })

        render(<MemoryRouter><AnnualView /></MemoryRouter>)

        // Wait for the table to appear
        await screen.findByText('Bills')

        for (const month of ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                              'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']) {
            expect(screen.getByText(month)).toBeInTheDocument()
        }
    })

    it('shows the correct planned amount for a category in its month', async () => {
        // Bills has 950.00 planned in January only
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: makeAnnualPlan(2026, { 0: [makePlanRow({ planned: '950.00' })] }),
        })

        render(<MemoryRouter><AnnualView /></MemoryRouter>)

        await screen.findByText('Bills')
        // 950.00 appears in the Jan cell, the row total, the monthly total, and grand total
        expect(screen.getAllByText('950.00').length).toBeGreaterThan(0)
    })

    it('shows "—" for months where a category has zero planned amount', async () => {
        // Bills has a planned amount only in January; Feb–Dec should all show "—"
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: makeAnnualPlan(2026, { 0: [makePlanRow({ planned: '100.00' })] }),
        })

        render(<MemoryRouter><AnnualView /></MemoryRouter>)

        await screen.findByText('Bills')
        // At minimum: 11 dashes for Feb–Dec in the category row
        const dashes = screen.getAllByText('—')
        expect(dashes.length).toBeGreaterThanOrEqual(11)
    })

    // =========================================================================
    // Year navigation
    // =========================================================================

    it('shows the current year (2026) as the page heading on initial load', async () => {
        // toFake: ['Date'] fakes only the Date constructor, leaving setTimeout/Promise
        // timers real so findByRole's internal waitFor still works correctly.
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-06-15'))
        try {
            vi.mocked(axios.get).mockResolvedValueOnce({ data: makeAnnualPlan(2026) })

            render(<MemoryRouter><AnnualView /></MemoryRouter>)

            // h2 shows the year number once loading completes
            const heading = await screen.findByRole('heading', { level: 2 })
            expect(heading).toHaveTextContent('2026')
        } finally {
            vi.useRealTimers()
        }
    })

    it('fetches the previous year when < Prev is clicked', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-06-15'))
        try {
            vi.mocked(axios.get)
                .mockResolvedValueOnce({ data: makeAnnualPlan(2026) }) // initial load
                .mockResolvedValueOnce({ data: makeAnnualPlan(2025) }) // after prev

            render(<MemoryRouter><AnnualView /></MemoryRouter>)

            // Wait for initial load then click Prev
            await screen.findByRole('heading', { level: 2 })
            await userEvent.click(screen.getByRole('button', { name: /prev/i }))

            await waitFor(() => {
                expect(vi.mocked(axios.get)).toHaveBeenCalledWith(
                    expect.stringContaining(`${getApiBaseUrl()}/api/v1/plan/2025`),
                    expect.anything()
                )
            })
        } finally {
            vi.useRealTimers()
        }
    })

    it('fetches the next year when Next > is clicked', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-06-15'))
        try {
            vi.mocked(axios.get)
                .mockResolvedValueOnce({ data: makeAnnualPlan(2026) }) // initial load
                .mockResolvedValueOnce({ data: makeAnnualPlan(2027) }) // after next

            render(<MemoryRouter><AnnualView /></MemoryRouter>)

            await screen.findByRole('heading', { level: 2 })
            await userEvent.click(screen.getByRole('button', { name: /next/i }))

            await waitFor(() => {
                expect(vi.mocked(axios.get)).toHaveBeenCalledWith(
                    expect.stringContaining(`${getApiBaseUrl()}/api/v1/plan/2027`),
                    expect.anything()
                )
            })
        } finally {
            vi.useRealTimers()
        }
    })
})
