// pages/MonthlyPlanView.test.tsx
//
// Purpose: Tests for the MonthlyPlanView component.
//
// Test coverage:
//   - Loading state while fetch is in progress
//   - Error state when the fetch fails
//   - Empty state when the month has no rows
//   - Table renders categories with correct amounts
//   - Child categories are indented under their parents
//   - Remaining shown in green (positive), red (negative), grey (zero)
//   - "< Prev" button moves to the previous month
//   - "Next >" button moves to the next month
//   - Year boundary navigation (January - 1 = December previous year)
//
// Month heading is what we assert for navigation — it changes when the user
// clicks Prev or Next, so it is the easiest observable outcome.
//
// axios is mocked globally — no real HTTP requests made.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest'
import axios from 'axios'
import MonthlyPlanView from './MonthlyPlanView'

vi.mock('axios')

// --- Helpers ---

const makeScheduleRow = (overrides: Record<string, unknown> = {}) => ({
    schedule_id: 'sched-1',
    schedule_name: 'Weekly Groceries',
    planned: '200.00',
    ...overrides,
})

const makeRow = (overrides: Record<string, unknown> = {}) => ({
    category_id: 'cat-1',
    category_name: 'Food & Drink',
    parent_category_id: null,
    planned: '200.00',
    actual: '150.00',
    remaining: '50.00',
    pending: '0.00',
    schedules: [],
    ...overrides,
})

const makePlan = (rowOverrides: Record<string, unknown>[] = [{}]) => ({
    year: 2026,
    month: 4,
    rows: rowOverrides.map(makeRow),
    total_planned: '200.00',
    total_actual: '150.00',
    total_remaining: '50.00',
    total_pending: '0.00',
})

const emptyPlan = {
    year: 2026,
    month: 4,
    rows: [],
    total_planned: '0.00',
    total_actual: '0.00',
    total_remaining: '0.00',
    total_pending: '0.00',
}


describe('MonthlyPlanView', () => {
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
        vi.mocked(axios.get).mockReturnValueOnce(new Promise<never>(() => {}))

        render(<MemoryRouter><MonthlyPlanView /></MemoryRouter>)

        expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })

    it('shows an error message when the fetch fails', async () => {
        vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network error'))

        render(<MemoryRouter><MonthlyPlanView /></MemoryRouter>)

        expect(await screen.findByText(/could not load plan/i)).toBeInTheDocument()
    })

    it('shows an empty-state message when the month has no rows', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: emptyPlan })

        render(<MemoryRouter><MonthlyPlanView /></MemoryRouter>)

        expect(await screen.findByText(/no activity this month/i)).toBeInTheDocument()
    })

    // =========================================================================
    // Table content
    // =========================================================================

    it('renders category names and amounts in the table', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: makePlan([{ category_name: 'Food & Drink', planned: '200.00', actual: '150.00', remaining: '50.00' }]),
        })

        render(<MemoryRouter><MonthlyPlanView /></MemoryRouter>)

        expect(await screen.findByText('Food & Drink')).toBeInTheDocument()
        // 200.00 appears in both the data row and the totals footer — getAllByText is fine
        expect(screen.getAllByText('200.00').length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText('150.00').length).toBeGreaterThanOrEqual(1)
    })

    it('indents child categories under their parent', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: {
                ...emptyPlan,
                rows: [
                    makeRow({ category_id: 'parent-1', category_name: 'Food & Drink', parent_category_id: null }),
                    makeRow({ category_id: 'child-1', category_name: 'Groceries', parent_category_id: 'parent-1' }),
                ],
            },
        })

        render(<MemoryRouter><MonthlyPlanView /></MemoryRouter>)

        await screen.findByText('Food & Drink')

        // The child cell should have a paddingLeft style applied
        const childCell = screen.getByText('Groceries').closest('td')
        expect(childCell).toHaveStyle({ paddingLeft: '2rem' })

        // The parent cell should NOT have paddingLeft
        const parentCell = screen.getByText('Food & Drink').closest('td')
        expect(parentCell).not.toHaveStyle({ paddingLeft: '2rem' })
    })

    it('colours remaining green when positive (under budget)', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: makePlan([{ remaining: '50.00' }]),
        })

        render(<MemoryRouter><MonthlyPlanView /></MemoryRouter>)

        await screen.findByText('Food & Drink')

        // The remaining cell text is "50.00" — find the td containing it
        // (there may be multiple "50.00" values; the remaining column is the 4th <td>)
        const rows = screen.getAllByRole('row')
        // The first data row is rows[1] (rows[0] is the header)
        const dataCells = rows[1].querySelectorAll('td')
        const remainingCell = dataCells[3] // 0=name, 1=planned, 2=actual, 3=remaining
        // jsdom converts CSS color keywords to rgb values
        expect(remainingCell).toHaveStyle({ color: 'rgb(0, 128, 0)' })
    })

    it('colours remaining red when negative (overspent)', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: makePlan([{ remaining: '-25.00' }]),
        })

        render(<MemoryRouter><MonthlyPlanView /></MemoryRouter>)

        await screen.findByText('Food & Drink')

        const rows = screen.getAllByRole('row')
        const dataCells = rows[1].querySelectorAll('td')
        const remainingCell = dataCells[3]
        // jsdom converts 'red' to rgb
        expect(remainingCell).toHaveStyle({ color: 'rgb(255, 0, 0)' })
    })

    it('colours remaining grey when zero (exactly on budget)', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: makePlan([{ remaining: '0.00' }]),
        })

        render(<MemoryRouter><MonthlyPlanView /></MemoryRouter>)

        await screen.findByText('Food & Drink')

        const rows = screen.getAllByRole('row')
        const dataCells = rows[1].querySelectorAll('td')
        const remainingCell = dataCells[3]
        // jsdom converts 'grey' to rgb(128, 128, 128)
        expect(remainingCell).toHaveStyle({ color: 'rgb(128, 128, 128)' })
    })

    // =========================================================================
    // Category drill-down links
    // =========================================================================

    it('renders non-zero actual amounts as links to the category transactions view', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: makePlan([{ category_id: 'cat-1', actual: '150.00' }]),
        })

        render(<MemoryRouter><MonthlyPlanView /></MemoryRouter>)

        await screen.findByText('Food & Drink')

        // The actual amount in the data row should be a clickable link
        const link = screen.getByRole('link', { name: '150.00' })
        expect(link).toHaveAttribute('href', expect.stringContaining('/transactions?category_id=cat-1'))
    })

    it('renders zero actual amounts as plain text with no link', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: makePlan([{ category_id: 'cat-1', actual: '0.00' }]),
        })

        render(<MemoryRouter><MonthlyPlanView /></MemoryRouter>)

        await screen.findByText('Food & Drink')

        // actual column is cells[2] in the first data row (0=name, 1=planned, 2=actual)
        const rows = screen.getAllByRole('row')
        const actualCell = rows[1].querySelectorAll('td')[2]

        expect(actualCell).toHaveTextContent('0.00')
        // No <a> element inside the cell — zero amount does not drill down
        expect(actualCell.querySelector('a')).toBeNull()
    })

    // =========================================================================
    // Schedule expand/collapse
    // =========================================================================

    it('shows schedule rows when a category with schedules is expanded (default)', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: makePlan([{
                category_id: 'cat-1',
                category_name: 'Food & Drink',
                schedules: [
                    makeScheduleRow({ schedule_name: 'Weekly Groceries', planned: '120.00' }),
                    makeScheduleRow({ schedule_id: 'sched-2', schedule_name: 'Coffee Subscription', planned: '80.00' }),
                ],
            }]),
        })

        render(<MemoryRouter><MonthlyPlanView /></MemoryRouter>)

        await screen.findByText('Food & Drink')

        // Categories with schedules are expanded by default — schedule names visible
        expect(screen.getByText('Weekly Groceries')).toBeInTheDocument()
        expect(screen.getByText('Coffee Subscription')).toBeInTheDocument()
    })

    it('hides schedule rows when a category is collapsed', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: makePlan([{
                category_id: 'cat-1',
                category_name: 'Food & Drink',
                schedules: [makeScheduleRow({ schedule_name: 'Weekly Groceries' })],
            }]),
        })

        render(<MemoryRouter><MonthlyPlanView /></MemoryRouter>)

        await screen.findByText('Food & Drink')

        // Schedule visible by default (expanded)
        expect(screen.getByText('Weekly Groceries')).toBeInTheDocument()

        // Click the collapse button
        await userEvent.click(screen.getByRole('button', { name: /collapse food/i }))

        // Schedule row should be hidden
        expect(screen.queryByText('Weekly Groceries')).not.toBeInTheDocument()
    })

    it('toggle button re-expands a collapsed category', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: makePlan([{
                category_id: 'cat-1',
                category_name: 'Food & Drink',
                schedules: [makeScheduleRow({ schedule_name: 'Weekly Groceries' })],
            }]),
        })

        render(<MemoryRouter><MonthlyPlanView /></MemoryRouter>)

        await screen.findByText('Food & Drink')

        // Collapse first
        await userEvent.click(screen.getByRole('button', { name: /collapse food/i }))
        expect(screen.queryByText('Weekly Groceries')).not.toBeInTheDocument()

        // Re-expand
        await userEvent.click(screen.getByRole('button', { name: /expand food/i }))
        expect(screen.getByText('Weekly Groceries')).toBeInTheDocument()
    })

    // =========================================================================
    // Month navigation
    // =========================================================================

    it('shows a Prev button and a Next button', async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: emptyPlan })

        render(<MemoryRouter><MonthlyPlanView /></MemoryRouter>)

        await screen.findByText(/no activity/i)

        expect(screen.getByRole('button', { name: /prev/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument()
    })

    it('navigates to the previous month when Prev is clicked', async () => {
        // First call: the current month (whatever month the component defaults to)
        // Second call: the previous month, triggered by the Prev click
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: emptyPlan })
            .mockResolvedValueOnce({ data: emptyPlan })

        render(<MemoryRouter><MonthlyPlanView /></MemoryRouter>)

        await screen.findByText(/no activity/i)

        // Capture current heading to compare after navigation
        const headingBefore = screen.getByRole('heading', { level: 2 }).textContent

        await userEvent.click(screen.getByRole('button', { name: /prev/i }))

        // Wait for the heading to change (re-fetch resolves)
        await waitFor(() => {
            const headingAfter = screen.getByRole('heading', { level: 2 }).textContent
            expect(headingAfter).not.toBe(headingBefore)
        })
    })

    it('navigates to the next month when Next is clicked', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: emptyPlan })
            .mockResolvedValueOnce({ data: emptyPlan })

        render(<MemoryRouter><MonthlyPlanView /></MemoryRouter>)

        await screen.findByText(/no activity/i)

        const headingBefore = screen.getByRole('heading', { level: 2 }).textContent

        await userEvent.click(screen.getByRole('button', { name: /next/i }))

        await waitFor(() => {
            const headingAfter = screen.getByRole('heading', { level: 2 }).textContent
            expect(headingAfter).not.toBe(headingBefore)
        })
    })

    it('handles year boundary: navigating back from January goes to December', async () => {
        vi.mocked(axios.get)
            .mockResolvedValue({ data: emptyPlan })

        render(<MemoryRouter><MonthlyPlanView /></MemoryRouter>)

        await screen.findByText(/no activity/i)

        // Navigate back until we hit January in the heading, then go back once more
        // For robustness, we directly test the shiftMonth logic by observing the heading.
        // We click Prev enough times to cross a year boundary — but that's complex.
        // Instead, assert that after 12 Prev clicks from any month, the year decreases by 1.
        const headingBefore = screen.getByRole('heading', { level: 2 }).textContent ?? ''
        const yearBefore = parseInt(headingBefore.split(' ').pop() ?? '0', 10)

        // 12 Prev clicks = 12 months back = 1 year back
        for (let i = 0; i < 12; i++) {
            await userEvent.click(screen.getByRole('button', { name: /prev/i }))
        }

        await waitFor(() => {
            const headingAfter = screen.getByRole('heading', { level: 2 }).textContent ?? ''
            const yearAfter = parseInt(headingAfter.split(' ').pop() ?? '0', 10)
            expect(yearAfter).toBe(yearBefore - 1)
        })
    })
})
