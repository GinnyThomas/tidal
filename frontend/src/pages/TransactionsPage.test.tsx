// pages/TransactionsPage.test.tsx
//
// Purpose: Tests for TransactionsPage — the main transactions list view.
//
// Test strategy:
//   Four render states (loading, error, empty, list), inline status toggle,
//   account filter, category filter (including URL pre-selection), and form
//   toggle for Add Transaction / Add Transfer.
//
// Three axios.get calls happen on mount: accounts and transactions (main filter
// effect, Promise.all), then categories (separate mount-only effect). Mocks are
// consumed in that order. The mockFetch() helper queues all three automatically.
// On re-fetch (filter change), only accounts and transactions are re-fetched —
// categories use the already-populated state from the mount-only effect.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import TransactionsPage from './TransactionsPage'
import { getApiBaseUrl } from '../lib/api'

vi.mock('axios')

const makeAccount = (overrides = {}) => ({
    id: 'acc-001',
    name: 'Current Account',
    account_type: 'checking',
    currency: 'GBP',
    current_balance: '1500.00',
    institution: null,
    is_active: true,
    ...overrides,
})

const makeCategory = (overrides = {}) => ({
    id: 'cat-001',
    name: 'Groceries',
    parent_category_id: null,
    ...overrides,
})

const makeTransaction = (overrides = {}) => ({
    id: 'tx-001',
    account_id: 'acc-001',
    category_id: 'cat-001',
    category_name: 'Groceries',
    category_icon: null,
    parent_transaction_id: null,
    promotion_id: null,
    schedule_id: null,
    date: '2026-04-01',
    payee: 'Tesco',
    amount: '45.50',
    currency: 'GBP',
    transaction_type: 'expense',
    status: 'pending',
    note: null,
    created_at: '2026-04-01T10:00:00',
    ...overrides,
})

// Helper: queue the three standard mocks for a page mount.
// Consumption order matches effect definition order:
//   1. accounts  — main filter effect, Promise.all call #1
//   2. transactions — main filter effect, Promise.all call #2
//   3. categories — separate mount-only effect (does NOT re-run on filter change)
// Pass categories as the 3rd arg to test category filter dropdown UI.
function mockFetch(
    accounts = [makeAccount()],
    transactions: ReturnType<typeof makeTransaction>[] = [],
    categories: ReturnType<typeof makeCategory>[] = [],
) {
    vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: accounts })
        .mockResolvedValueOnce({ data: transactions })
        .mockResolvedValueOnce({ data: categories })
}

describe('TransactionsPage', () => {
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
        // Accounts and categories resolve; transactions never does — Promise.all
        // stays pending so the page remains in loading state.
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })                  // accounts
            .mockReturnValueOnce(new Promise<never>(() => {}))    // transactions
            .mockResolvedValueOnce({ data: [] })                  // categories

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })

    it('shows an error message when the fetch fails', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })                         // accounts
            .mockRejectedValueOnce(new Error('Network error'))           // transactions
            .mockResolvedValueOnce({ data: [] })                         // categories

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        expect(await screen.findByText(/could not load/i)).toBeInTheDocument()
    })

    it('shows an empty-state message when there are no transactions', async () => {
        mockFetch([], [])

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        expect(await screen.findByText(/no transactions/i)).toBeInTheDocument()
    })

    it('renders a list of transactions after a successful fetch', async () => {
        mockFetch(
            [makeAccount({ id: 'acc-001', name: 'Current Account' })],
            [makeTransaction({ payee: 'Tesco', amount: '45.50', status: 'pending', transaction_type: 'expense', category_name: 'Groceries' })],
        )

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        // Payee, amount, account name, category name, and status badge all visible
        expect(await screen.findByText('Tesco')).toBeInTheDocument()
        // Amount and currency are rendered together ("45.50 GBP") in one cell
        expect(screen.getByText(/45\.50/)).toBeInTheDocument()
        // Account and category names also appear as <option> text in the filter
        // dropdowns — use selector:'td' to match only the table cell occurrences.
        expect(screen.getByText('Current Account', { selector: 'td' })).toBeInTheDocument()
        expect(screen.getByText('Groceries', { selector: 'td' })).toBeInTheDocument()
        // Status badge is a button for the inline toggle
        expect(screen.getByRole('button', { name: /pending/i })).toBeInTheDocument()
    })

    // =========================================================================
    // Inline status toggle
    // =========================================================================

    it('cycles status from pending to cleared when the status badge is clicked', async () => {
        mockFetch(
            [makeAccount()],
            [makeTransaction({ id: 'tx-001', status: 'pending' })],
        )
        vi.mocked(axios.put).mockResolvedValueOnce({ data: {} })

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        const badge = await screen.findByRole('button', { name: /pending/i })
        await userEvent.click(badge)

        await waitFor(() => {
            expect(vi.mocked(axios.put)).toHaveBeenCalledWith(
                `${getApiBaseUrl()}/api/v1/transactions/tx-001`,
                { status: 'cleared' },
                expect.objectContaining({ headers: { Authorization: 'Bearer fake-token' } })
            )
        })

        // Optimistic update: badge now shows "cleared"
        expect(await screen.findByRole('button', { name: /cleared/i })).toBeInTheDocument()
    })

    it('cycles status from cleared to reconciled', async () => {
        mockFetch([makeAccount()], [makeTransaction({ status: 'cleared' })])
        vi.mocked(axios.put).mockResolvedValueOnce({ data: {} })

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await userEvent.click(await screen.findByRole('button', { name: /cleared/i }))

        await waitFor(() => {
            expect(vi.mocked(axios.put)).toHaveBeenCalledWith(
                expect.stringContaining('/api/v1/transactions/'),
                { status: 'reconciled' },
                expect.anything()
            )
        })
    })

    it('cycles status from reconciled back to pending', async () => {
        mockFetch([makeAccount()], [makeTransaction({ status: 'reconciled' })])
        vi.mocked(axios.put).mockResolvedValueOnce({ data: {} })

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await userEvent.click(await screen.findByRole('button', { name: /reconciled/i }))

        await waitFor(() => {
            expect(vi.mocked(axios.put)).toHaveBeenCalledWith(
                expect.stringContaining('/api/v1/transactions/'),
                { status: 'pending' },
                expect.anything()
            )
        })
    })

    // =========================================================================
    // Account filter
    // =========================================================================

    it('sends account_id param when an account filter is selected', async () => {
        // Initial mount: accounts + transactions (main effect) + categories (separate effect).
        // Re-fetch after filter change: accounts + transactions only — categories NOT re-fetched.
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount({ id: 'acc-001', name: 'Current' })] })
            .mockResolvedValueOnce({ data: [] })   // initial transactions
            .mockResolvedValueOnce({ data: [] })   // initial categories (mount-only effect)
            .mockResolvedValueOnce({ data: [makeAccount({ id: 'acc-001', name: 'Current' })] })
            .mockResolvedValueOnce({ data: [] })   // filtered transactions (no categories re-fetch)

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText(/no transactions/i)

        await userEvent.selectOptions(screen.getByLabelText(/filter by account/i), 'acc-001')

        await waitFor(() => {
            const calls = vi.mocked(axios.get).mock.calls
            const txCall = calls.find(
                ([url, config]) =>
                    String(url).includes('/api/v1/transactions') &&
                    (config as { params?: { account_id?: string } })?.params?.account_id === 'acc-001'
            )
            expect(txCall).toBeDefined()
        })
    })

    // =========================================================================
    // Category filter
    // =========================================================================

    it('renders a category filter dropdown populated with fetched categories', async () => {
        mockFetch([], [], [makeCategory({ id: 'cat-001', name: 'Groceries' })])

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText(/no transactions/i)

        // The filter select is labelled and the fetched category appears as an option
        expect(screen.getByLabelText(/filter by category/i)).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'Groceries' })).toBeInTheDocument()
    })

    it('sends category_id param when category filter is selected', async () => {
        // Initial mount (3 mocks) — include a category so the dropdown has an option to select
        mockFetch([], [], [makeCategory({ id: 'cat-001', name: 'Groceries' })])
        // Re-fetch after selection: accounts + transactions only (no categories)
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [] })

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText(/no transactions/i)

        await userEvent.selectOptions(screen.getByLabelText(/filter by category/i), 'cat-001')

        await waitFor(() => {
            const calls = vi.mocked(axios.get).mock.calls
            const txCall = calls.find(
                ([url, config]) =>
                    String(url).includes('/api/v1/transactions') &&
                    (config as { params?: { category_id?: string } })?.params?.category_id === 'cat-001'
            )
            expect(txCall).toBeDefined()
        })
    })

    it('pre-selects the category filter when ?category_id is in the URL', async () => {
        mockFetch([], [], [makeCategory({ id: 'cat-001', name: 'Groceries' })])

        // MemoryRouter initialEntries sets the initial URL including query string
        render(
            <MemoryRouter initialEntries={['/transactions?category_id=cat-001']}>
                <TransactionsPage />
            </MemoryRouter>
        )

        await screen.findByText(/no transactions/i)

        // The dropdown should be pre-selected with the URL value
        expect(screen.getByLabelText(/filter by category/i)).toHaveValue('cat-001')
        // The "Filtered by:" badge should be visible with the resolved category name
        expect(screen.getByText('Filtered by:')).toBeInTheDocument()
    })

    // =========================================================================
    // Add Transaction / Add Transfer buttons
    // =========================================================================

    it('shows the Add Transaction button once loaded', async () => {
        mockFetch()

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        expect(await screen.findByRole('button', { name: /add transaction/i })).toBeInTheDocument()
    })

    it('shows AddTransactionForm when Add Transaction is clicked', async () => {
        mockFetch()
        // AddTransactionForm also fetches accounts + categories on mount
        vi.mocked(axios.get).mockResolvedValue({ data: [] })

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await userEvent.click(await screen.findByRole('button', { name: /add transaction/i }))

        // The form's type select is a distinctive field
        expect(screen.getByLabelText(/type/i)).toBeInTheDocument()
    })

    it('hides AddTransactionForm when Add Transaction is clicked a second time', async () => {
        mockFetch()

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        const btn = await screen.findByRole('button', { name: /add transaction/i })
        await userEvent.click(btn)
        await userEvent.click(btn)

        expect(screen.queryByLabelText(/type/i)).not.toBeInTheDocument()
    })

    it('shows AddTransferForm when Add Transfer is clicked', async () => {
        mockFetch()
        vi.mocked(axios.get).mockResolvedValue({ data: [] })

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await userEvent.click(await screen.findByRole('button', { name: /add transfer/i }))

        expect(screen.getByLabelText(/from account/i)).toBeInTheDocument()
    })

    // =========================================================================
    // Integration: transaction added triggers re-fetch
    // =========================================================================

    it('re-fetches and hides the form after a transaction is added', async () => {
        // Initial mount: accounts + transactions (main effect) + categories (mount-only effect)
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })        // page: accounts
            .mockResolvedValueOnce({ data: [] })        // page: transactions
            .mockResolvedValueOnce({ data: [] })        // page: categories (mount-only effect)
        // AddTransactionForm's own account/category/promotions fetch
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
            .mockResolvedValueOnce({ data: [] })  // promotions
        // Post succeeds
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })
        // Re-fetch after add: accounts + transactions only (categories NOT re-fetched)
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [makeTransaction({ payee: 'Sainsbury\'s' })] })

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText(/no transactions/i)

        await userEvent.click(screen.getByRole('button', { name: /add transaction/i }))

        await screen.findByRole('option', { name: 'Current Account' })
        await userEvent.type(screen.getByLabelText(/amount/i), '30')
        await userEvent.click(screen.getByRole('button', { name: /save transaction/i }))

        expect(await screen.findByText("Sainsbury's")).toBeInTheDocument()
        // Form should be hidden
        expect(screen.queryByLabelText(/type/i)).not.toBeInTheDocument()
    })

    // =========================================================================
    // Edit transaction
    // =========================================================================

    it('shows an Edit button on each transaction row', async () => {
        mockFetch(
            [makeAccount()],
            [makeTransaction({ payee: 'Tesco' })],
        )

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText('Tesco')
        expect(screen.getByRole('button', { name: /^edit transaction/i })).toBeInTheDocument()
    })

    it('clicking Edit opens AddTransactionForm in edit mode', async () => {
        mockFetch(
            [makeAccount()],
            [makeTransaction({ payee: 'Tesco', amount: '45.50', status: 'pending' })],
        )
        // AddTransactionForm fetches accounts + categories on mount
        vi.mocked(axios.get).mockResolvedValue({ data: [] })

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText('Tesco')
        await userEvent.click(screen.getByRole('button', { name: /^edit transaction/i }))

        // The edit form heading should be visible
        expect(screen.getByText('Edit Transaction')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /update transaction/i })).toBeInTheDocument()
    })

    // =========================================================================
    // Sorting
    // =========================================================================

    it('sorts transactions by date descending by default (newest first)', async () => {
        mockFetch(
            [makeAccount()],
            [
                makeTransaction({ id: 'tx-1', date: '2026-01-01', payee: 'Older' }),
                makeTransaction({ id: 'tx-2', date: '2026-04-15', payee: 'Newer' }),
            ],
        )

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText('Older')

        // Get the payee cells in order to verify sort
        const rows = screen.getAllByRole('row')
        // rows[0] is header, rows[1] is first data row, rows[2] is second
        const firstPayee = rows[1].querySelectorAll('td')[1].textContent
        const secondPayee = rows[2].querySelectorAll('td')[1].textContent
        // Descending by date: Newer (2026-04-15) first, Older (2026-01-01) second
        expect(firstPayee).toBe('Newer')
        expect(secondPayee).toBe('Older')
    })

    it('clicking Date header toggles sort direction', async () => {
        mockFetch(
            [makeAccount()],
            [
                makeTransaction({ id: 'tx-1', date: '2026-01-01', payee: 'Older' }),
                makeTransaction({ id: 'tx-2', date: '2026-04-15', payee: 'Newer' }),
            ],
        )

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText('Older')

        // Click Date header — default is desc, clicking toggles to asc
        await userEvent.click(screen.getByText(/^Date/))

        const rows = screen.getAllByRole('row')
        const firstPayee = rows[1].querySelectorAll('td')[1].textContent
        // Ascending by date: Older (2026-01-01) first
        expect(firstPayee).toBe('Older')
    })

    it('clicking a different column sorts by that column ascending', async () => {
        mockFetch(
            [makeAccount()],
            [
                makeTransaction({ id: 'tx-1', payee: 'Zara', amount: '10.00' }),
                makeTransaction({ id: 'tx-2', payee: 'Aldi', amount: '20.00' }),
            ],
        )

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText('Zara')

        // Click Payee header — sorts alphabetically ascending
        await userEvent.click(screen.getByText(/^Payee/))

        const rows = screen.getAllByRole('row')
        const firstPayee = rows[1].querySelectorAll('td')[1].textContent
        expect(firstPayee).toBe('Aldi')
    })

    it('sorts by category name when Category header is clicked', async () => {
        mockFetch(
            [makeAccount()],
            [
                makeTransaction({ id: 'tx-1', payee: 'A', category_name: 'Utilities' }),
                makeTransaction({ id: 'tx-2', payee: 'B', category_name: 'Bills' }),
            ],
        )

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText('Utilities')
        await userEvent.click(screen.getByText(/^Category/))

        const rows = screen.getAllByRole('row')
        // Ascending: Bills before Utilities
        expect(rows[1].querySelectorAll('td')[2].textContent).toBe('Bills')
        expect(rows[2].querySelectorAll('td')[2].textContent).toBe('Utilities')
    })

    it('sorts by account name when Account header is clicked', async () => {
        mockFetch(
            [
                makeAccount({ id: 'acc-a', name: 'Santander' }),
                makeAccount({ id: 'acc-b', name: 'Nationwide' }),
            ],
            [
                makeTransaction({ id: 'tx-1', account_id: 'acc-a', payee: 'X' }),
                makeTransaction({ id: 'tx-2', account_id: 'acc-b', payee: 'Y' }),
            ],
        )

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        // Wait for the table to render — use payee as the anchor since
        // account names also appear in the filter dropdown options
        await screen.findByText('X')
        // "Account" button is inside the table header — use getByRole to target the sort button
        const accountSortBtn = screen.getByRole('button', { name: /^Account/ })
        await userEvent.click(accountSortBtn)

        const rows = screen.getAllByRole('row')
        // Ascending: Nationwide before Santander
        expect(rows[1].querySelectorAll('td')[3].textContent).toBe('Nationwide')
    })
})
