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
import { annualPlanCache } from '../lib/annualPlanCache'
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
    group: null,
    ...overrides,
})

// Build a full 12-month AnnualPlan.
// rowsByMonth is 0-indexed: { 0: [rows for Jan], 3: [rows for Apr], ... }
// Months not specified get empty rows.
function makeAnnualPlan(
    year = 2026,
    rowsByMonth: Record<number, ReturnType<typeof makePlanRow>[]> = {},
    openingBalances: object[] = [],
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
        opening_balances: openingBalances,
    }
}

describe('AnnualView', () => {
    beforeEach(() => {
        localStorage.setItem('access_token', 'fake-token')
    })

    afterEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
        // Clear the module-level session cache so each test starts fresh
        annualPlanCache.clear()
    })

    // =========================================================================
    // Session cache
    // =========================================================================

    it('uses cached data and skips the API call when the year is already cached', async () => {
        // Pre-populate the cache with data for 2026
        const cachedPlan = makeAnnualPlan(2026, { 0: [makePlanRow({ category_name: 'Bills' })] })
        // Cache key format is "year:group" — empty group for default view
        annualPlanCache.set('2026:', cachedPlan)

        // Fix the system clock so the component defaults to 2026
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-06-15'))
        try {
            render(<MemoryRouter><AnnualView /></MemoryRouter>)

            // The cached category should appear immediately — no loading state
            expect(await screen.findByText('Bills')).toBeInTheDocument()

            // axios.get should NOT have been called — data came from the cache
            expect(vi.mocked(axios.get)).not.toHaveBeenCalled()
        } finally {
            vi.useRealTimers()
        }
    })

    // =========================================================================
    // Render states
    // =========================================================================

    it('shows a loading indicator while the fetch is in progress', () => {
        // Never resolves — component stays in loading state
        vi.mocked(axios.get).mockReturnValueOnce(new Promise<never>(() => {}))

        render(<MemoryRouter><AnnualView /></MemoryRouter>)

        expect(screen.getByText(/building your annual plan/i)).toBeInTheDocument()
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

    // =========================================================================
    // Group sections
    // =========================================================================

    it('shows group section headers and subtotals when rows span multiple groups', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: makeAnnualPlan(2026, {
                0: [
                    makePlanRow({ category_id: 'cat-uk', category_name: 'Groceries UK', planned: '300.00', group: 'UK' }),
                    makePlanRow({ category_id: 'cat-es', category_name: 'Groceries España', planned: '200.00', group: 'España' }),
                ],
            }),
        })

        render(<MemoryRouter><AnnualView /></MemoryRouter>)

        await screen.findByText('Groceries UK')

        // Section headers
        expect(screen.getByText(/── UK ──/i)).toBeInTheDocument()
        expect(screen.getByText(/── España ──/i)).toBeInTheDocument()

        // Subtotal rows
        expect(screen.getByText('── UK Total')).toBeInTheDocument()
        expect(screen.getByText('── España Total')).toBeInTheDocument()

        // Verify UK subtotal Jan column shows 300.00
        // Subtotal row: cells[0]=label, cells[1]=Jan, ... cells[12]=Dec, cells[13]=Total
        const ukSubtotalRow = screen.getByText('── UK Total').closest('tr')!
        const ukCells = ukSubtotalRow.querySelectorAll('td')
        expect(ukCells[1].textContent).toBe('300.00') // Jan
        expect(ukCells[13].textContent).toBe('300.00') // Annual total

        // España subtotal: 200.00 in Jan only
        const esSubtotalRow = screen.getByText('── España Total').closest('tr')!
        const esCells = esSubtotalRow.querySelectorAll('td')
        expect(esCells[1].textContent).toBe('200.00')
    })

    it('does not show group sections when only one group exists', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: makeAnnualPlan(2026, {
                0: [makePlanRow({ group: 'UK' })],
            }),
        })

        render(<MemoryRouter><AnnualView /></MemoryRouter>)

        await screen.findByText('Bills')

        expect(screen.queryByText(/── UK ──/i)).not.toBeInTheDocument()
        expect(screen.queryByText(/── UK Total/)).not.toBeInTheDocument()
    })

    // =========================================================================
    // Cash flow
    // =========================================================================

    it('shows cash flow rows when "Show cash flow" is toggled on', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: makeAnnualPlan(2026, {
                0: [
                    makePlanRow({ category_id: 'cat-uk', category_name: 'Groceries UK', planned: '300.00', group: 'UK' }),
                    makePlanRow({ category_id: 'cat-es', category_name: 'Groceries España', planned: '200.00', group: 'España' }),
                ],
            }, [
                { id: 'ob-1', user_id: 'u-1', group: 'UK', year: 2026, opening_balance: '5000.00', currency: 'GBP', created_at: '', updated_at: '' },
            ]),
        })

        render(<MemoryRouter><AnnualView /></MemoryRouter>)

        await screen.findByText('Groceries UK')

        // Cash flow rows NOT visible by default
        expect(screen.queryByText('Opening Balance')).not.toBeInTheDocument()

        // Toggle on
        await userEvent.click(screen.getByLabelText(/show cash flow/i))

        // Opening and Closing Balance rows should appear (one per group section)
        expect(screen.getAllByText('Opening Balance').length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText('Closing Balance').length).toBeGreaterThanOrEqual(1)
        // UK opening balance value visible
        expect(screen.getByText('5000.00')).toBeInTheDocument()
    })
})
