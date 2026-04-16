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
    parent_category_id: null,
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

    // =========================================================================
    // Group sections
    // =========================================================================

    it('shows group section headers when budgets span multiple groups', async () => {
        mockFetch(
            [
                makeBudget({ id: 'bud-uk', category_id: 'cat-001', group: 'UK' }),
                makeBudget({ id: 'bud-es', category_id: 'cat-002', group: 'España', default_amount: '200.00' }),
            ],
            [
                makeCategory({ id: 'cat-001', name: 'Groceries UK' }),
                makeCategory({ id: 'cat-002', name: 'Groceries España' }),
            ],
        )

        render(<MemoryRouter><BudgetsPage /></MemoryRouter>)

        await screen.findByText('Groceries UK')

        expect(screen.getByText(/── UK ──/i)).toBeInTheDocument()
        expect(screen.getByText(/── España ──/i)).toBeInTheDocument()
    })

    it('does not show group headers when only one group exists', async () => {
        mockFetch(
            [makeBudget({ group: 'UK' })],
            [makeCategory()],
        )

        render(<MemoryRouter><BudgetsPage /></MemoryRouter>)

        await screen.findByText('Groceries UK')

        expect(screen.queryByText(/── UK ──/i)).not.toBeInTheDocument()
    })

    // =========================================================================
    // Parent/child hierarchy
    // =========================================================================

    it('renders a synthetic parent header row when a child budget has no parent budget', async () => {
        // Parent category "Food" (no budget), child category "Groceries UK"
        // with a budget whose parent_category_id points at Food.
        mockFetch(
            [makeBudget({
                id: 'bud-child',
                category_id: 'cat-groceries',
                parent_category_id: 'cat-food',
                group: 'UK',
            })],
            [
                makeCategory({ id: 'cat-food', name: 'Food', parent_category_id: null }),
                makeCategory({ id: 'cat-groceries', name: 'Groceries UK', parent_category_id: 'cat-food' }),
            ],
        )

        render(<MemoryRouter><BudgetsPage /></MemoryRouter>)

        // Synthetic parent header "Food" renders even though no budget exists for it
        expect(await screen.findByText('Food')).toBeInTheDocument()
        // Child budget renders under the synthetic header
        expect(screen.getByText('Groceries UK')).toBeInTheDocument()
        // Synthetic parent has no Edit button (only the child does)
        const editButtons = screen.queryAllByRole('button', { name: /edit budget/i })
        expect(editButtons).toHaveLength(1)
    })

    it('renders parent budgets as bold and child budgets indented', async () => {
        // Both parent and child have budgets. Parent row renders the category
        // name in bold (font-semibold); child row renders indented with
        // a teal left border on its Category cell.
        mockFetch(
            [
                makeBudget({
                    id: 'bud-parent',
                    category_id: 'cat-food',
                    parent_category_id: null,
                    group: 'UK',
                    default_amount: '500.00',
                }),
                makeBudget({
                    id: 'bud-child',
                    category_id: 'cat-groceries',
                    parent_category_id: 'cat-food',
                    group: 'UK',
                    default_amount: '200.00',
                }),
            ],
            [
                makeCategory({ id: 'cat-food', name: 'Food', parent_category_id: null }),
                makeCategory({ id: 'cat-groceries', name: 'Groceries UK', parent_category_id: 'cat-food' }),
            ],
        )

        render(<MemoryRouter><BudgetsPage /></MemoryRouter>)

        // Parent category name is rendered in bold
        const parentName = await screen.findByText('Food')
        expect(parentName).toHaveClass('font-semibold')

        // Child category name is not bold — lighter slate-300
        const childName = screen.getByText('Groceries UK')
        expect(childName).not.toHaveClass('font-semibold')
        expect(childName).toHaveClass('text-slate-300')
    })
})
