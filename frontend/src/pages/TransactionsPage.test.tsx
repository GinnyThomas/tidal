// pages/TransactionsPage.test.tsx
//
// Purpose: Tests for TransactionsPage — the main transactions list view.
//
// Test strategy:
//   Four render states (loading, error, empty, list), inline status toggle,
//   account filter, category filter (including URL pre-selection), form
//   toggle for Add Transaction / Add Transfer, date quick filters,
//   pagination controls, and notes display.
//
// Three axios.get calls happen on mount: accounts and transactions (main filter
// effect, Promise.all), then categories (separate mount-only effect). Mocks are
// consumed in that order. The mockFetch() helper queues all three automatically.
// On re-fetch (filter change), only accounts and transactions are re-fetched —
// categories use the already-populated state from the mount-only effect.
//
// The transactions endpoint returns a paginated envelope:
//   { items: [...], total, page, page_size, total_pages }

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
    calculated_balance: '1300.00',
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
    is_split: false,
    splits: [],
    ...overrides,
})

const emptyTotals = { expenses: [], income: [], transfers: [], net: [] }

// Wrap a list of transactions into the paginated response envelope
function paginate(
    items: ReturnType<typeof makeTransaction>[],
    page = 1,
    page_size = 50,
    totals = emptyTotals,
) {
    return {
        items,
        total: items.length,
        page,
        page_size,
        total_pages: Math.max(1, Math.ceil(items.length / page_size)),
        totals,
    }
}

// Helper: queue the three standard mocks for a page mount.
// Consumption order matches effect declaration order:
//   1. accounts   — mount-only effect
//   2. categories — mount-only effect
//   3. transactions — filter effect (paginated envelope)
// Pass categories as the 3rd arg to test category filter dropdown UI.
function mockFetch(
    accounts = [makeAccount()],
    transactions: ReturnType<typeof makeTransaction>[] = [],
    categories: ReturnType<typeof makeCategory>[] = [],
) {
    vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: accounts })
        .mockResolvedValueOnce({ data: categories })
        .mockResolvedValueOnce({ data: paginate(transactions) })
}

describe('TransactionsPage', () => {
    beforeEach(() => {
        localStorage.setItem('access_token', 'fake-token')
        // Fix date for consistent date preset calculations
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-05-15'))
    })

    afterEach(() => {
        localStorage.clear()
        vi.resetAllMocks()
        vi.useRealTimers()
    })

    // =========================================================================
    // Render states
    // =========================================================================

    it('shows a loading indicator while the fetch is in progress', () => {
        // Accounts and categories resolve; transactions never does — page
        // stays in loading state.
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })                  // accounts
            .mockResolvedValueOnce({ data: [] })                  // categories
            .mockReturnValueOnce(new Promise<never>(() => {}))    // transactions

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })

    it('shows an error message when the fetch fails', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })                         // accounts
            .mockResolvedValueOnce({ data: [] })                         // categories
            .mockRejectedValueOnce(new Error('Network error'))           // transactions

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
        // Initial mount: accounts + categories (mount effects) + transactions (filter effect).
        // Re-fetch after filter change: only transactions re-fetched.
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount({ id: 'acc-001', name: 'Current' })] }) // accounts
            .mockResolvedValueOnce({ data: [] })   // categories
            .mockResolvedValueOnce({ data: paginate([]) })   // initial transactions
            .mockResolvedValueOnce({ data: paginate([]) })   // filtered transactions

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
        // Re-fetch after selection: only transactions
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: paginate([]) })

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

    it('pre-selects the status filter when ?status=pending is in the URL', async () => {
        mockFetch()

        render(
            <MemoryRouter initialEntries={['/transactions?status=pending']}>
                <TransactionsPage />
            </MemoryRouter>
        )

        await screen.findByText(/no transactions/i)

        expect(screen.getByLabelText(/filter by status/i)).toHaveValue('pending')
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
        // Initial mount: accounts + categories (mount effects) + transactions (filter effect)
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })        // page: accounts
            .mockResolvedValueOnce({ data: [] })        // page: categories
            .mockResolvedValueOnce({ data: paginate([]) })        // page: transactions
        // AddTransactionForm's own account/category/promotions fetch
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
            .mockResolvedValueOnce({ data: [] })  // promotions
        // Post succeeds
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })
        // Re-fetch after add: only transactions (accounts/categories already fetched on mount)
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: paginate([makeTransaction({ payee: 'Sainsbury\'s' })]) })

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
    // Server-side sorting
    // =========================================================================

    it('sends sort_by=date and sort_dir=desc by default', async () => {
        mockFetch([makeAccount()], [makeTransaction()])

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText('Tesco')

        const calls = vi.mocked(axios.get).mock.calls
        const txCall = calls.find(([url]) => String(url).includes('/api/v1/transactions'))
        const params = (txCall![1] as { params: Record<string, string> }).params
        expect(params.sort_by).toBe('date')
        expect(params.sort_dir).toBe('desc')
    })

    it('clicking Date header toggles sort direction and re-fetches', async () => {
        mockFetch([makeAccount()], [makeTransaction()])
        // Re-fetch after sort change (only transactions)
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: paginate([makeTransaction()]) })

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText('Tesco')

        // Click Date — default is desc, should toggle to asc
        await userEvent.click(screen.getByText(/^Date/))

        await waitFor(() => {
            const calls = vi.mocked(axios.get).mock.calls
            const sortCall = calls.find(
                ([url, config]) =>
                    String(url).includes('/api/v1/transactions') &&
                    (config as { params?: Record<string, string> })?.params?.sort_dir === 'asc'
            )
            expect(sortCall).toBeDefined()
        })
    })

    it('clicking a different column sends sort_by for that column ascending', async () => {
        mockFetch([makeAccount()], [makeTransaction()])
        // Re-fetch after sort change (only transactions)
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: paginate([makeTransaction()]) })

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText('Tesco')

        await userEvent.click(screen.getByText(/^Payee/))

        await waitFor(() => {
            const calls = vi.mocked(axios.get).mock.calls
            const sortCall = calls.find(
                ([url, config]) =>
                    String(url).includes('/api/v1/transactions') &&
                    (config as { params?: Record<string, string> })?.params?.sort_by === 'payee' &&
                    (config as { params?: Record<string, string> })?.params?.sort_dir === 'asc'
            )
            expect(sortCall).toBeDefined()
        })
    })

    it('clicking Category header sends sort_by=category_name', async () => {
        mockFetch([makeAccount()], [makeTransaction()])
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: paginate([makeTransaction()]) })

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText('Tesco')
        await userEvent.click(screen.getByText(/^Category/))

        await waitFor(() => {
            const calls = vi.mocked(axios.get).mock.calls
            const sortCall = calls.find(
                ([url, config]) =>
                    String(url).includes('/api/v1/transactions') &&
                    (config as { params?: Record<string, string> })?.params?.sort_by === 'category_name'
            )
            expect(sortCall).toBeDefined()
        })
    })

    it('clicking Account header sends sort_by=account_name', async () => {
        mockFetch([makeAccount()], [makeTransaction()])
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: paginate([makeTransaction()]) })

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText('Tesco')
        const accountSortBtn = screen.getByRole('button', { name: /^Account/ })
        await userEvent.click(accountSortBtn)

        await waitFor(() => {
            const calls = vi.mocked(axios.get).mock.calls
            const sortCall = calls.find(
                ([url, config]) =>
                    String(url).includes('/api/v1/transactions') &&
                    (config as { params?: Record<string, string> })?.params?.sort_by === 'account_name'
            )
            expect(sortCall).toBeDefined()
        })
    })

    // =========================================================================
    // Account balance indicator
    // =========================================================================

    it('shows account balance when a specific account is selected in the filter', async () => {
        const acct = makeAccount({ id: 'acc-001', name: 'Current', calculated_balance: '2500.00', currency: 'GBP' })
        mockFetch([acct], [makeTransaction()])

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText('Tesco')

        // No balance shown initially (All accounts)
        expect(screen.queryByText(/Balance:/)).not.toBeInTheDocument()

        // Queue mock for the re-fetch that will fire when filter changes (only transactions)
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: paginate([makeTransaction()]) })

        // Select a specific account — triggers re-fetch
        await userEvent.selectOptions(screen.getByLabelText(/filter by account/i), 'acc-001')

        await waitFor(() => {
            expect(screen.getByText(/Balance:/)).toBeInTheDocument()
            expect(screen.getByText('2500.00 GBP')).toBeInTheDocument()
        })
    })

    // =========================================================================
    // Search (server-side — payee and notes)
    // =========================================================================

    it('sends search param to the API when search is set via URL', async () => {
        // Mount with ?search=weekly — the API call should include search=weekly
        mockFetch([makeAccount()], [makeTransaction()])

        render(
            <MemoryRouter initialEntries={['/transactions?search=weekly']}>
                <TransactionsPage />
            </MemoryRouter>
        )

        await screen.findByText('Tesco')

        const calls = vi.mocked(axios.get).mock.calls
        const searchCall = calls.find(
            ([url, config]) =>
                String(url).includes('/api/v1/transactions') &&
                (config as { params?: Record<string, string> })?.params?.search === 'weekly'
        )
        expect(searchCall).toBeDefined()
    })

    it('clears search param when clear button is clicked', async () => {
        // Pre-populate search via URL so clear button is visible on mount
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })   // accounts
            .mockResolvedValueOnce({ data: [] })                // categories
            .mockResolvedValueOnce({ data: paginate([makeTransaction()]) }) // transactions with search
            // Re-fetch after clear (only transactions, no search param)
            .mockResolvedValueOnce({ data: paginate([makeTransaction()]) })

        render(
            <MemoryRouter initialEntries={['/transactions?search=hello']}>
                <TransactionsPage />
            </MemoryRouter>
        )

        await screen.findByText('Tesco')

        // Clear button should be visible because search is pre-filled
        await userEvent.click(screen.getByLabelText(/clear search/i))

        // After clearing, the search input should be empty
        expect(screen.getByPlaceholderText(/search payee or notes/i)).toHaveValue('')

        // The next API call should NOT include a search param
        await waitFor(() => {
            const calls = vi.mocked(axios.get).mock.calls
            // Find the last transactions call (after clear)
            const txCalls = calls.filter(([url]) => String(url).includes('/api/v1/transactions'))
            const lastTxCall = txCalls[txCalls.length - 1]
            const params = (lastTxCall[1] as { params?: Record<string, string> })?.params
            expect(params?.search).toBeUndefined()
        })
    })

    it('reads search from URL params on mount', async () => {
        mockFetch([makeAccount()], [makeTransaction()])

        render(
            <MemoryRouter initialEntries={['/transactions?search=gift']}>
                <TransactionsPage />
            </MemoryRouter>
        )

        await screen.findByText('Tesco')

        // Search input pre-filled
        expect(screen.getByPlaceholderText(/search payee or notes/i)).toHaveValue('gift')

        // API called with search param
        const calls = vi.mocked(axios.get).mock.calls
        const searchCall = calls.find(
            ([url, config]) =>
                String(url).includes('/api/v1/transactions') &&
                (config as { params?: Record<string, string> })?.params?.search === 'gift'
        )
        expect(searchCall).toBeDefined()
    })

    // =========================================================================
    // Split transactions
    // =========================================================================

    it('shows a "split" badge on split transactions', async () => {
        mockFetch(
            [makeAccount()],
            [makeTransaction({ id: 'tx-split', is_split: true, category_id: null, category_name: null, splits: [
                { id: 's1', transaction_id: 'tx-split', category_id: 'cat-001', category_name: 'Groceries', promotion_id: null, amount: '30.00', note: null },
                { id: 's2', transaction_id: 'tx-split', category_id: 'cat-002', category_name: 'Electronics', promotion_id: null, amount: '15.50', note: null },
            ] })],
        )

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        expect(await screen.findByText('split')).toBeInTheDocument()
    })

    // =========================================================================
    // Date quick filters
    // =========================================================================

    it('"This Month" quick filter sets correct date range params', async () => {
        // System time is May 15 2026 (set in beforeEach)
        mockFetch()

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText(/no transactions/i)

        // "This Month" is the default — check that the API was called with the right params
        const calls = vi.mocked(axios.get).mock.calls
        const txCall = calls.find(
            ([url, config]) =>
                String(url).includes('/api/v1/transactions') &&
                (config as { params?: Record<string, string> })?.params?.date_from === '2026-05-01'
        )
        expect(txCall).toBeDefined()
        const params = (txCall![1] as { params: Record<string, string> }).params
        expect(params.date_to).toBe('2026-05-31')
    })

    // =========================================================================
    // Pagination
    // =========================================================================

    it('renders pagination controls with correct page info', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })   // accounts
            .mockResolvedValueOnce({ data: [] })                // categories
            .mockResolvedValueOnce({ data: {                    // transactions
                items: [makeTransaction()],
                total: 75,
                page: 1,
                page_size: 50,
                total_pages: 2,
            }})

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText('Tesco')

        // Page info
        expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
        expect(screen.getByText(/Showing 1-50 of 75 transactions/)).toBeInTheDocument()

        // Prev disabled, Next enabled
        expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled()
        expect(screen.getByRole('button', { name: /next page/i })).not.toBeDisabled()
    })

    // =========================================================================
    // Notes display
    // =========================================================================

    it('shows note icon only on transactions with notes', async () => {
        mockFetch(
            [makeAccount()],
            [
                makeTransaction({ id: 'tx-1', payee: 'Tesco', note: 'Weekly shop' }),
                makeTransaction({ id: 'tx-2', payee: 'Amazon', note: null }),
            ],
        )

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText('Tesco')

        // Only one note toggle button (for Tesco with note)
        const noteButtons = screen.getAllByRole('button', { name: /toggle note/i })
        expect(noteButtons).toHaveLength(1)
    })

    it('clicking note icon toggles note text display', async () => {
        mockFetch(
            [makeAccount()],
            [makeTransaction({ id: 'tx-1', payee: 'Tesco', note: 'Weekly shop' })],
        )

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText('Tesco')

        // Note text not visible initially
        expect(screen.queryByText('Weekly shop')).not.toBeInTheDocument()

        // Click note icon
        await userEvent.click(screen.getByRole('button', { name: /toggle note/i }))

        // Note text now visible
        expect(screen.getByText('Weekly shop')).toBeInTheDocument()

        // Click again to collapse
        await userEvent.click(screen.getByRole('button', { name: /toggle note/i }))
        expect(screen.queryByText('Weekly shop')).not.toBeInTheDocument()
    })

    // =========================================================================
    // Transaction totals
    // =========================================================================

    it('totals card row renders when category filter is active', async () => {
        const totals = {
            expenses: [{ currency: 'GBP', amount: '100.00' }],
            income: [], transfers: [], net: [{ currency: 'GBP', amount: '-100.00' }],
        }
        // Mount with category filter via URL
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
            .mockResolvedValueOnce({ data: paginate([makeTransaction()], 1, 50, totals) })

        render(
            <MemoryRouter initialEntries={['/transactions?category_id=cat-001']}>
                <TransactionsPage />
            </MemoryRouter>
        )

        await screen.findByText('Tesco')
        expect(screen.getByLabelText('Transaction totals')).toBeInTheDocument()
        expect(screen.getByText('Expenses')).toBeInTheDocument()
    })

    it('totals card row does NOT render when no filter is active', async () => {
        mockFetch([makeAccount()], [makeTransaction()])
        // Re-fetch after clicking "All" preset
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: paginate([makeTransaction()]) })

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText('Tesco')

        // Default is "This Month" which sets dateFrom — totals visible.
        // Click "All" to clear the date filter.
        await userEvent.click(screen.getByLabelText(/date filter: all/i))

        await waitFor(() => {
            expect(screen.queryByLabelText('Transaction totals')).not.toBeInTheDocument()
        })
    })

    it('totals card row renders when only date filter is active', async () => {
        const totals = {
            expenses: [{ currency: 'GBP', amount: '50.00' }],
            income: [], transfers: [], net: [{ currency: 'GBP', amount: '-50.00' }],
        }
        // Default mount has "This Month" preset which sets dateFrom/dateTo
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: paginate([makeTransaction()], 1, 50, totals) })

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        await screen.findByText('Tesco')
        // "This Month" sets dateFrom, so totals should show
        expect(screen.getByLabelText('Transaction totals')).toBeInTheDocument()
    })

    it('four cards appear with correct labels', async () => {
        const totals = {
            expenses: [{ currency: 'GBP', amount: '200.00' }],
            income: [{ currency: 'GBP', amount: '500.00' }],
            transfers: [{ currency: 'GBP', amount: '50.00' }],
            net: [{ currency: 'GBP', amount: '300.00' }],
        }
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
            .mockResolvedValueOnce({ data: paginate([makeTransaction()], 1, 50, totals) })

        render(
            <MemoryRouter initialEntries={['/transactions?category_id=cat-001']}>
                <TransactionsPage />
            </MemoryRouter>
        )

        await screen.findByText('Tesco')
        expect(screen.getByText('Expenses')).toBeInTheDocument()
        expect(screen.getByText('Income')).toBeInTheDocument()
        expect(screen.getByText('Transfers')).toBeInTheDocument()
        expect(screen.getByText('Net')).toBeInTheDocument()
    })

    it('multi-currency totals display stacked lines', async () => {
        const totals = {
            expenses: [
                { currency: 'EUR', amount: '45.00' },
                { currency: 'GBP', amount: '100.00' },
            ],
            income: [], transfers: [], net: [
                { currency: 'EUR', amount: '-45.00' },
                { currency: 'GBP', amount: '-100.00' },
            ],
        }
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
            .mockResolvedValueOnce({ data: paginate([makeTransaction()], 1, 50, totals) })

        render(
            <MemoryRouter initialEntries={['/transactions?category_id=cat-001']}>
                <TransactionsPage />
            </MemoryRouter>
        )

        await screen.findByText('Tesco')
        // Both currency lines present — EUR and GBP amounts both appear
        expect(screen.getAllByText(/45\.00/).length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText(/100\.00/).length).toBeGreaterThanOrEqual(1)
    })

    it('empty totals show em-dash', async () => {
        const totals = {
            expenses: [{ currency: 'GBP', amount: '100.00' }],
            income: [],
            transfers: [],
            net: [{ currency: 'GBP', amount: '-100.00' }],
        }
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
            .mockResolvedValueOnce({ data: paginate([makeTransaction()], 1, 50, totals) })

        render(
            <MemoryRouter initialEntries={['/transactions?category_id=cat-001']}>
                <TransactionsPage />
            </MemoryRouter>
        )

        await screen.findByText('Tesco')
        // Income and Transfers are empty — should show em-dash
        const dashes = screen.getAllByText('—')
        expect(dashes.length).toBeGreaterThanOrEqual(2)
    })

    it('net negative displays in red, positive in green', async () => {
        const totals = {
            expenses: [],
            income: [{ currency: 'GBP', amount: '500.00' }],
            transfers: [],
            net: [{ currency: 'GBP', amount: '500.00' }],
        }
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
            .mockResolvedValueOnce({ data: paginate([makeTransaction()], 1, 50, totals) })

        render(
            <MemoryRouter initialEntries={['/transactions?category_id=cat-001']}>
                <TransactionsPage />
            </MemoryRouter>
        )

        await screen.findByText('Tesco')
        // Find the net value — positive should have success color
        const netValue = screen.getByText(/\+/)
        expect(netValue).toHaveClass('text-success')
    })

    it('account balance display and totals row coexist when account filter is active', async () => {
        const acct = makeAccount({ id: 'acc-001', name: 'Current', calculated_balance: '2500.00', currency: 'GBP' })
        const totals = {
            expenses: [{ currency: 'GBP', amount: '100.00' }],
            income: [], transfers: [],
            net: [{ currency: 'GBP', amount: '-100.00' }],
        }
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [acct] })
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: paginate([makeTransaction()], 1, 50, totals) })
            // Re-fetch after filter change
            .mockResolvedValueOnce({ data: paginate([makeTransaction()], 1, 50, totals) })

        render(
            <MemoryRouter initialEntries={['/transactions?account_id=acc-001']}>
                <TransactionsPage />
            </MemoryRouter>
        )

        await screen.findByText('Tesco')

        // Both should be visible
        expect(screen.getByText(/Balance:/)).toBeInTheDocument()
        expect(screen.getByLabelText('Transaction totals')).toBeInTheDocument()
    })

    it('net card displays 0.00 when income equals expenses', async () => {
        const totals = {
            expenses: [{ currency: 'GBP', amount: '100.00' }],
            income: [{ currency: 'GBP', amount: '100.00' }],
            transfers: [],
            net: [{ currency: 'GBP', amount: '0.00' }],
        }
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
            .mockResolvedValueOnce({ data: paginate([makeTransaction()], 1, 50, totals) })

        render(
            <MemoryRouter initialEntries={['/transactions?category_id=cat-001']}>
                <TransactionsPage />
            </MemoryRouter>
        )

        await screen.findByText('Tesco')

        // Net card should show £0.00 (not em-dash)
        // The totals area has the "Net" label and should contain 0.00
        const totalsArea = screen.getByLabelText('Transaction totals')
        expect(totalsArea.textContent).toContain('0.00')
        // No em-dash in the Net card — verify net label's sibling has real value
        const netLabel = screen.getByText('Net')
        const netCard = netLabel.parentElement!
        expect(netCard.textContent).toContain('0.00')
        expect(netCard.textContent).not.toContain('—')
    })
})
