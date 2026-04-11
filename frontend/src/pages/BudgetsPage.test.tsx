// pages/BudgetsPage.test.tsx
//
// Purpose: Tests for BudgetsPage — the budget management view.
//
// Test strategy:
//   Loading, error, and empty states; budget list rendering; Add Budget
//   toggle; Edit button opens pre-populated form; year navigation.
//
// Two axios.get calls on mount: budgets (with year param) and categories.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import BudgetsPage from './BudgetsPage'

vi.mock('axios')

const makeCategory = (overrides = {}) => ({
    id: 'cat-001',
    name: 'Groceries UK',
    parent_category_id: null,
    ...overrides,
})

const makeBudget = (overrides = {}) => ({
    id: 'bud-001',
    user_id: 'user-001',
    category_id: 'cat-001',
    year: 2026,
    default_amount: '300.00',
    currency: 'GBP',
    group: 'UK',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    overrides: [],
    ...overrides,
})

// Helper: queue the two standard mocks (budgets + categories)
function mockFetch(
    budgets = [makeBudget()],
    categories = [makeCategory()],
) {
    vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: budgets })
        .mockResolvedValueOnce({ data: categories })
}

describe('BudgetsPage', () => {
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
        // Budget fetch never resolves — page stays in loading state.
        // Categories effect also fires but doesn't affect loading state.
        vi.mocked(axios.get)
            .mockReturnValueOnce(new Promise<never>(() => {}))    // budgets
            .mockResolvedValueOnce({ data: [] })                  // categories

        render(<MemoryRouter><BudgetsPage /></MemoryRouter>)

        expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })

    it('shows an error message when the fetch fails', async () => {
        vi.mocked(axios.get)
            .mockRejectedValueOnce(new Error('Network error'))
            .mockResolvedValueOnce({ data: [] })

        render(<MemoryRouter><BudgetsPage /></MemoryRouter>)

        expect(await screen.findByText(/could not load budgets/i)).toBeInTheDocument()
    })

    it('shows an empty state when there are no budgets', async () => {
        mockFetch([], [])

        render(<MemoryRouter><BudgetsPage /></MemoryRouter>)

        expect(await screen.findByText(/no budgets/i)).toBeInTheDocument()
    })

    // =========================================================================
    // Budget list
    // =========================================================================

    it('renders a budget table after a successful fetch', async () => {
        mockFetch()

        render(<MemoryRouter><BudgetsPage /></MemoryRouter>)

        expect(await screen.findByText('Groceries UK')).toBeInTheDocument()
        expect(screen.getByText('300.00')).toBeInTheDocument()
        expect(screen.getByText('GBP')).toBeInTheDocument()
        // "UK" appears in both the filter dropdown and the table cell — use selector
        expect(screen.getByText('UK', { selector: 'td' })).toBeInTheDocument()
    })

    // =========================================================================
    // Add Budget
    // =========================================================================

    it('shows AddBudgetForm when Add Budget is clicked', async () => {
        mockFetch([], [makeCategory()])
        vi.mocked(axios.get).mockResolvedValue({ data: [] })

        render(<MemoryRouter><BudgetsPage /></MemoryRouter>)

        await screen.findByText(/no budgets/i)
        await userEvent.click(screen.getByRole('button', { name: /add budget/i }))

        expect(screen.getByLabelText(/default monthly amount/i)).toBeInTheDocument()
        expect(screen.getByText('New Budget')).toBeInTheDocument()
    })

    // =========================================================================
    // Edit Budget
    // =========================================================================

    it('clicking Edit opens AddBudgetForm in edit mode', async () => {
        mockFetch()

        render(<MemoryRouter><BudgetsPage /></MemoryRouter>)

        await screen.findByText('Groceries UK')
        await userEvent.click(screen.getByRole('button', { name: /edit budget/i }))

        expect(screen.getByText('Edit Budget')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /update budget/i })).toBeInTheDocument()
    })

    // =========================================================================
    // Year navigation
    // =========================================================================

    it('year navigation buttons change the displayed year', async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: [] })

        render(<MemoryRouter><BudgetsPage /></MemoryRouter>)

        await screen.findByText(/no budgets/i)

        const currentYear = new Date().getFullYear()
        expect(screen.getByText(String(currentYear))).toBeInTheDocument()

        await userEvent.click(screen.getByRole('button', { name: /next/i }))

        await waitFor(() => {
            expect(screen.getByText(String(currentYear + 1))).toBeInTheDocument()
        })
    })

    // =========================================================================
    // Overrides expand
    // =========================================================================

    it('expand button shows override form inline', async () => {
        mockFetch([makeBudget({ overrides: [{ id: 'ov-1', budget_id: 'bud-001', month: 12, amount: '350.00' }] })])

        render(<MemoryRouter><BudgetsPage /></MemoryRouter>)

        await screen.findByText('Groceries UK')
        await userEvent.click(screen.getByRole('button', { name: /expand overrides/i }))

        // The override form should show 12 month labels
        expect(screen.getByText('Jan')).toBeInTheDocument()
        expect(screen.getByText('Dec')).toBeInTheDocument()
        // The override amount for December should be visible
        expect(screen.getByText('350.00')).toBeInTheDocument()
    })
})
