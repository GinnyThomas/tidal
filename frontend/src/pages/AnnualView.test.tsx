// pages/AnnualView.test.tsx
//
// Purpose: Tests for AnnualView — the annual budget spreadsheet.
//
// Test strategy:
//   Loading state, error state, empty state (no planned amounts across the year),
//   12 month column headers, category amounts, "—" for zero amounts,
//   year navigation, group sections with separate expense/income subtotals,
//   cash flow (on by default), and carrying the previous year's closing
//   balance forward as the opening balance.
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
    is_income: false,
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

    it('formats amounts >= 1000 with comma separators', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: makeAnnualPlan(2026, { 0: [makePlanRow({ planned: '1500.00' })] }),
        })

        render(<MemoryRouter><AnnualView /></MemoryRouter>)

        await screen.findByText('Bills')
        // 1500.00 should be formatted as "1,500.00" with comma separator
        expect(screen.getAllByText('1,500.00').length).toBeGreaterThan(0)
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
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-06-15'))
        try {
            vi.mocked(axios.get).mockResolvedValueOnce({ data: makeAnnualPlan(2026) })

            render(<MemoryRouter><AnnualView /></MemoryRouter>)

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

    it('shows group section headers and separate expense subtotals when rows span multiple groups', async () => {
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

        // Separate expense subtotal rows (not a combined "── UK Total")
        expect(screen.getByText('── UK Expenses Total ──')).toBeInTheDocument()
        expect(screen.getByText('── España Expenses Total ──')).toBeInTheDocument()

        // Verify UK expense subtotal Jan column shows 300.00
        const ukSubtotalRow = screen.getByText('── UK Expenses Total ──').closest('tr')!
        const ukCells = ukSubtotalRow.querySelectorAll('td')
        expect(ukCells[1].textContent).toBe('300.00') // Jan
        expect(ukCells[13].textContent).toBe('300.00') // Annual total

        // España expense subtotal: 200.00 in Jan only
        const esSubtotalRow = screen.getByText('── España Expenses Total ──').closest('tr')!
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
        expect(screen.queryByText(/── UK Expenses Total/)).not.toBeInTheDocument()
    })

    // =========================================================================
    // Cash flow (on by default)
    // =========================================================================

    it('shows cash flow rows by default (no toggle needed)', async () => {
        // Use a date before 2026 so all months are future (use planned amounts)
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2025-12-15'))
        try {
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

            // Cash flow rows visible by default (showCashFlow starts true)
            expect(screen.getAllByText('Opening Balance').length).toBeGreaterThanOrEqual(1)
            expect(screen.getAllByText('Closing Balance').length).toBeGreaterThanOrEqual(1)
            // UK opening balance value visible (may also appear in closing balance cells)
            expect(screen.getAllByText('5,000.00').length).toBeGreaterThanOrEqual(1)
        } finally {
            vi.useRealTimers()
        }
    })

    it('hides cash flow rows when "Show cash flow" is toggled off', async () => {
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

        // Cash flow visible by default
        expect(screen.getAllByText('Opening Balance').length).toBeGreaterThanOrEqual(1)

        // Toggle off
        await userEvent.click(screen.getByLabelText(/show cash flow/i))

        // Cash flow rows should be gone
        expect(screen.queryByText('Opening Balance')).not.toBeInTheDocument()
        expect(screen.queryByText('Closing Balance')).not.toBeInTheDocument()
    })

    it('uses actual amounts for past months and planned for current/future in closing balance', async () => {
        // Fix date to March 2026 (month index 2) — Jan and Feb are past
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-03-15'))
        try {
            // Expense category: planned 100/month, but actuals differ in Jan/Feb
            // Jan actual=80, Feb actual=120, Mar-Dec planned=100
            const rows = (monthIdx: number) => {
                const actual = monthIdx === 0 ? '80.00' : monthIdx === 1 ? '120.00' : '0.00'
                return [
                    makePlanRow({
                        category_id: 'cat-uk',
                        category_name: 'Rent',
                        planned: '100.00',
                        actual,
                        group: 'UK',
                        is_income: false,
                    }),
                    makePlanRow({
                        category_id: 'cat-uk-salary',
                        category_name: 'Salary',
                        planned: '500.00',
                        actual: monthIdx < 2 ? '500.00' : '0.00',
                        group: 'UK',
                        is_income: true,
                    }),
                    makePlanRow({
                        category_id: 'cat-es',
                        category_name: 'Groceries ES',
                        planned: '50.00',
                        actual: '0.00',
                        group: 'España',
                        is_income: false,
                    }),
                ]
            }
            const rowsByMonth: Record<number, ReturnType<typeof makePlanRow>[]> = {}
            for (let i = 0; i < 12; i++) rowsByMonth[i] = rows(i)

            vi.mocked(axios.get).mockResolvedValueOnce({
                data: makeAnnualPlan(2026, rowsByMonth, [
                    { id: 'ob-1', user_id: 'u-1', group: 'UK', year: 2026, opening_balance: '1000.00', currency: 'GBP', created_at: '', updated_at: '' },
                    { id: 'ob-2', user_id: 'u-1', group: 'España', year: 2026, opening_balance: '0.00', currency: 'EUR', created_at: '', updated_at: '' },
                ]),
            })

            render(<MemoryRouter><AnnualView /></MemoryRouter>)

            await screen.findByText('Rent')

            // Find the Closing Balance row for UK
            const closingRow = screen.getAllByText('Closing Balance')[0].closest('tr')!
            const cells = closingRow.querySelectorAll('td')

            // Opening: 1000
            // Jan (past): income actual=500, expense actual=80 → 1000 + 500 - 80 = 1420
            expect(cells[1].textContent).toBe('1,420.00')

            // Feb (past): income actual=500, expense actual=120 → 1420 + 500 - 120 = 1800
            expect(cells[2].textContent).toBe('1,800.00')

            // Mar (current month, not past): uses planned → 1800 + 500 - 100 = 2200
            expect(cells[3].textContent).toBe('2,200.00')
        } finally {
            vi.useRealTimers()
        }
    })

    it('closing balance includes actual spend from categories with no planned amount', async () => {
        // Fix date to Feb 2026 — Jan is past
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-02-15'))
        try {
            // Two groups so grouped sections render.
            // "Surprise" has zero planned but £200 actual in Jan (past month).
            // This unplanned spend should reduce UK closing balance.
            const rowsByMonth: Record<number, ReturnType<typeof makePlanRow>[]> = {}
            for (let i = 0; i < 12; i++) {
                rowsByMonth[i] = [
                    makePlanRow({
                        category_id: 'cat-uk-rent',
                        category_name: 'Rent',
                        planned: '500.00',
                        actual: i === 0 ? '500.00' : '0.00',
                        group: 'UK',
                        is_income: false,
                    }),
                    makePlanRow({
                        category_id: 'cat-uk-surprise',
                        category_name: 'Surprise',
                        planned: '0.00',
                        actual: i === 0 ? '200.00' : '0.00',
                        group: 'UK',
                        is_income: false,
                    }),
                    makePlanRow({
                        category_id: 'cat-es',
                        category_name: 'Groceries ES',
                        planned: '50.00',
                        actual: '0.00',
                        group: 'España',
                        is_income: false,
                    }),
                ]
            }

            vi.mocked(axios.get).mockResolvedValueOnce({
                data: makeAnnualPlan(2026, rowsByMonth, [
                    { id: 'ob-1', user_id: 'u-1', group: 'UK', year: 2026, opening_balance: '2000.00', currency: 'GBP', created_at: '', updated_at: '' },
                    { id: 'ob-2', user_id: 'u-1', group: 'España', year: 2026, opening_balance: '0.00', currency: 'EUR', created_at: '', updated_at: '' },
                ]),
            })

            render(<MemoryRouter><AnnualView /></MemoryRouter>)

            await screen.findByText('Rent')

            const closingRow = screen.getAllByText('Closing Balance')[0].closest('tr')!
            const cells = closingRow.querySelectorAll('td')

            // Jan (past): actual expense = 500 (Rent) + 200 (Surprise) = 700
            // Closing Jan = 2000 - 700 = 1300
            expect(cells[1].textContent).toBe('1,300.00')

            // Feb (current, not past): planned expense = 500 (Rent) + 0 (Surprise) = 500
            // Closing Feb = 1300 - 500 = 800
            expect(cells[2].textContent).toBe('800.00')
        } finally {
            vi.useRealTimers()
        }
    })

    it('shows separate income subtotal when a group has income rows', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: makeAnnualPlan(2026, {
                0: [
                    makePlanRow({ category_id: 'cat-rent', category_name: 'Rent', planned: '1000.00', group: 'UK', is_income: false }),
                    makePlanRow({ category_id: 'cat-salary', category_name: 'Salary', planned: '3000.00', group: 'UK', is_income: true }),
                    makePlanRow({ category_id: 'cat-es', category_name: 'Groceries ES', planned: '200.00', group: 'España', is_income: false }),
                ],
            }),
        })

        render(<MemoryRouter><AnnualView /></MemoryRouter>)

        await screen.findByText('Rent')

        // Both expense and income subtotal rows for UK
        expect(screen.getByText('── UK Expenses Total ──')).toBeInTheDocument()
        expect(screen.getByText('── UK Income Total ──')).toBeInTheDocument()

        // España only has expenses — no income total
        expect(screen.getByText('── España Expenses Total ──')).toBeInTheDocument()
        expect(screen.queryByText('── España Income Total ──')).not.toBeInTheDocument()
    })

    // =========================================================================
    // Export buttons
    // =========================================================================

    it('renders Download PDF and Export CSV buttons', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: makeAnnualPlan(2026, { 0: [makePlanRow()] }),
        })

        render(<MemoryRouter><AnnualView /></MemoryRouter>)

        await screen.findByText('Bills')

        expect(screen.getByRole('button', { name: /download pdf/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /export csv/i })).toBeInTheDocument()
    })

    it('CSV export generates correct header row', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: makeAnnualPlan(2026, { 0: [makePlanRow()] }),
        })

        // Mock the Blob constructor and URL.createObjectURL to capture CSV content
        let capturedCsv = ''
        const origBlob = globalThis.Blob
        globalThis.Blob = class MockBlob {
            constructor(parts: string[]) { capturedCsv = parts[0] }
        } as unknown as typeof Blob
        const origCreate = URL.createObjectURL
        URL.createObjectURL = () => 'blob:mock'
        const origRevoke = URL.revokeObjectURL
        URL.revokeObjectURL = () => {}

        try {
            render(<MemoryRouter><AnnualView /></MemoryRouter>)
            await screen.findByText('Bills')

            await userEvent.click(screen.getByRole('button', { name: /export csv/i }))

            const headerLine = capturedCsv.split('\n')[0]
            expect(headerLine).toContain('"Category"')
            expect(headerLine).toContain('"Jan"')
            expect(headerLine).toContain('"Dec"')
            expect(headerLine).toContain('"Total"')
        } finally {
            globalThis.Blob = origBlob
            URL.createObjectURL = origCreate
            URL.revokeObjectURL = origRevoke
        }
    })

    // =========================================================================
    // Carry forward previous year's closing balance
    // =========================================================================

    describe('carry forward opening balance', () => {
        // 2026: opening 1,000, rent actual 100/month → closes at -200.00
        const plan2026 = () => {
            const rowsByMonth: Record<number, ReturnType<typeof makePlanRow>[]> = {}
            for (let i = 0; i < 12; i++) {
                rowsByMonth[i] = [makePlanRow({ category_name: 'Rent', planned: '100.00', actual: '100.00' })]
            }
            return makeAnnualPlan(2026, rowsByMonth, [
                { id: 'ob-26', group: 'General', year: 2026, opening_balance: '1000.00', currency: 'GBP' },
            ])
        }
        const plan2027 = (openingBalances: object[] = []) =>
            makeAnnualPlan(2027, { 0: [makePlanRow({ category_name: 'Rent' })] }, openingBalances)

        // Route GETs by URL so call order doesn't matter
        function mockPlans(plans: Record<number, () => object>) {
            vi.mocked(axios.get).mockImplementation((url: string) => {
                const year = Number(url.split('/').pop())
                return Promise.resolve({ data: plans[year]() })
            })
        }

        afterEach(() => {
            vi.useRealTimers()
        })

        it('offers to use the previous year\'s closing when there is no opening balance', async () => {
            vi.useFakeTimers({ toFake: ['Date'] })
            vi.setSystemTime(new Date('2027-01-10'))
            mockPlans({ 2027: () => plan2027() })

            render(<MemoryRouter><AnnualView /></MemoryRouter>)

            expect(await screen.findByRole('button', { name: 'Use 2026 closing' })).toBeInTheDocument()
            // 2026 is over, so the figure is final — no estimate warning
            expect(screen.queryByText(/estimate/i)).not.toBeInTheDocument()
        })

        it('does not offer it once an opening balance is set', async () => {
            vi.useFakeTimers({ toFake: ['Date'] })
            vi.setSystemTime(new Date('2027-01-10'))
            mockPlans({
                2027: () => plan2027([
                    { id: 'ob-27', group: 'General', year: 2027, opening_balance: '50.00', currency: 'GBP' },
                ]),
            })

            render(<MemoryRouter><AnnualView /></MemoryRouter>)

            await screen.findByText('Rent')
            expect(screen.queryByRole('button', { name: /closing$/i })).not.toBeInTheDocument()
        })

        it("fetches the previous year, saves its December closing as this year's opening, and shows it", async () => {
            vi.useFakeTimers({ toFake: ['Date'] })
            vi.setSystemTime(new Date('2027-01-10'))
            let saved = false
            vi.mocked(axios.get).mockImplementation((url: string) => {
                if (url.endsWith('/2026')) return Promise.resolve({ data: plan2026() })
                return Promise.resolve({
                    data: plan2027(saved
                        ? [{ id: 'ob-27', group: 'General', year: 2027, opening_balance: '-200.00', currency: 'GBP' }]
                        : []),
                })
            })
            vi.mocked(axios.post).mockImplementation(() => {
                saved = true
                return Promise.resolve({ data: {} })
            })

            render(<MemoryRouter><AnnualView /></MemoryRouter>)

            await userEvent.click(await screen.findByRole('button', { name: 'Use 2026 closing' }))

            expect(axios.get).toHaveBeenCalledWith(
                `${getApiBaseUrl()}/api/v1/plan/2026`,
                expect.anything(),
            )
            expect(axios.post).toHaveBeenCalledWith(
                `${getApiBaseUrl()}/api/v1/opening-balances`,
                { group: 'General', year: 2027, opening_balance: '-200.00', currency: 'GBP' },
                expect.anything(),
            )
            expect(await screen.findByText('-200.00')).toBeInTheDocument()
            expect(screen.queryByRole('button', { name: 'Use 2026 closing' })).not.toBeInTheDocument()
        })

        it('warns that the figure is an estimate while the previous year is still running', async () => {
            vi.useFakeTimers({ toFake: ['Date'] })
            vi.setSystemTime(new Date('2026-11-15'))
            mockPlans({
                2026: () => plan2026(),
                2027: () => plan2027(),
            })

            render(<MemoryRouter><AnnualView /></MemoryRouter>)

            await screen.findByText('Rent')
            await userEvent.click(screen.getByRole('button', { name: /next/i }))

            expect(await screen.findByRole('button', { name: 'Use 2026 closing' })).toBeInTheDocument()
            expect(screen.getByText(/estimate/i)).toBeInTheDocument()
        })

        it('does not report a failed carry-forward when the save worked but the reload failed', async () => {
            // Saying "could not carry forward" here would invite a retry that
            // then 409s, because the opening balance now exists.
            vi.useFakeTimers({ toFake: ['Date'] })
            vi.setSystemTime(new Date('2027-01-10'))
            let saved = false
            vi.mocked(axios.get).mockImplementation((url: string) => {
                if (url.endsWith('/2026')) return Promise.resolve({ data: plan2026() })
                return saved
                    ? Promise.reject(new Error('Network error'))
                    : Promise.resolve({ data: plan2027() })
            })
            vi.mocked(axios.post).mockImplementation(() => {
                saved = true
                return Promise.resolve({ data: {} })
            })

            render(<MemoryRouter><AnnualView /></MemoryRouter>)

            await userEvent.click(await screen.findByRole('button', { name: 'Use 2026 closing' }))

            expect(await screen.findByText(/could not load annual plan/i)).toBeInTheDocument()
            expect(screen.queryByText(/could not carry forward/i)).not.toBeInTheDocument()
        })

        it('while filtered, carries forward only that group\'s money, from the unfiltered previous year', async () => {
            // /plan?group= only filters budgets — schedules and transactions
            // from every group still come back, so the client must filter.
            vi.useFakeTimers({ toFake: ['Date'] })
            vi.setSystemTime(new Date('2027-01-10'))
            const mixedPlan = (year: number) => {
                const rowsByMonth: Record<number, ReturnType<typeof makePlanRow>[]> = {}
                for (let i = 0; i < 12; i++) {
                    rowsByMonth[i] = [
                        makePlanRow({ category_id: 'uk', category_name: 'Rent', planned: '100.00', actual: '100.00', group: 'UK' }),
                        makePlanRow({ category_id: 'es', category_name: 'Mercado', planned: '50.00', actual: '50.00', group: 'España' }),
                    ]
                }
                return makeAnnualPlan(year, rowsByMonth)
            }
            vi.mocked(axios.get).mockImplementation((url: string) =>
                Promise.resolve({ data: mixedPlan(url.endsWith('/2026') ? 2026 : 2027) }),
            )
            vi.mocked(axios.post).mockResolvedValue({ data: {} })

            render(<MemoryRouter><AnnualView /></MemoryRouter>)

            await screen.findByText('Mercado')
            await userEvent.selectOptions(screen.getByLabelText('Budget group'), 'España')
            await userEvent.click(await screen.findByRole('button', { name: 'Use 2026 closing' }))

            expect(axios.get).toHaveBeenCalledWith(
                `${getApiBaseUrl()}/api/v1/plan/2026`,
                expect.objectContaining({ params: {} }),
            )
            expect(axios.post).toHaveBeenCalledWith(
                `${getApiBaseUrl()}/api/v1/opening-balances`,
                { group: 'España', year: 2027, opening_balance: '-600.00', currency: 'EUR' },
                expect.anything(),
            )
        })

        it('shows an error if the carry-forward fails', async () => {
            vi.useFakeTimers({ toFake: ['Date'] })
            vi.setSystemTime(new Date('2027-01-10'))
            vi.mocked(axios.get).mockImplementation((url: string) =>
                url.endsWith('/2026')
                    ? Promise.reject(new Error('Network error'))
                    : Promise.resolve({ data: plan2027() }),
            )

            render(<MemoryRouter><AnnualView /></MemoryRouter>)

            await userEvent.click(await screen.findByRole('button', { name: 'Use 2026 closing' }))

            expect(await screen.findByText(/could not carry forward/i)).toBeInTheDocument()
        })
    })

    // =========================================================================
    // Filtered cash flow + opening balance save robustness
    // =========================================================================

    it("filtered to one group, the closing balance counts only that group's rows", async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2027-01-10'))
        try {
            // Server returns schedule rows from every group even when filtered
            const rows = [
                makePlanRow({ category_id: 'uk', category_name: 'Rent', planned: '100.00', group: 'UK' }),
                makePlanRow({ category_id: 'es', category_name: 'Mercado', planned: '50.00', group: 'España' }),
            ]
            vi.mocked(axios.get).mockResolvedValue({ data: makeAnnualPlan(2027, { 0: rows }) })

            render(<MemoryRouter><AnnualView /></MemoryRouter>)

            await screen.findByText('Mercado')
            await userEvent.selectOptions(screen.getByLabelText('Budget group'), 'España')

            await waitFor(() => {
                const closingRow = screen.getByText('Closing Balance').closest('tr')!
                expect(closingRow.querySelectorAll('td')[1].textContent).toBe('-50.00')
            })
        } finally {
            vi.useRealTimers()
        }
    })

    it('does not get stuck loading when the reload after an inline opening balance save fails', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2027-01-10'))
        try {
            let saved = false
            vi.mocked(axios.get).mockImplementation(() => saved
                ? Promise.reject(new Error('Network error'))
                : Promise.resolve({ data: makeAnnualPlan(2027, { 0: [makePlanRow({ category_name: 'Rent' })] }) }))
            vi.mocked(axios.post).mockImplementation(() => {
                saved = true
                return Promise.resolve({ data: {} })
            })

            render(<MemoryRouter><AnnualView /></MemoryRouter>)

            await userEvent.click(await screen.findByText('Set opening balance'))
            await userEvent.type(screen.getByRole('spinbutton'), '100{Enter}')

            expect(await screen.findByText(/could not load annual plan/i)).toBeInTheDocument()
            expect(screen.queryByText(/building your annual plan/i)).not.toBeInTheDocument()
        } finally {
            vi.useRealTimers()
        }
    })
})
