// pages/TransactionsPage.test.tsx
//
// Purpose: Tests for TransactionsPage — the main transactions list view.
//
// Test strategy:
//   Four render states (loading, error, empty, list), inline status toggle,
//   account filter, and form toggle for Add Transaction / Add Transfer.
//
// Three axios.get calls happen on mount: accounts, categories, transactions.
// Mocks must be queued in that order.

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

// Helper: queue the three standard mocks (accounts, categories, transactions)
function mockFetch(
    accounts = [makeAccount()],
    categories = [makeCategory()],
    transactions: ReturnType<typeof makeTransaction>[] = [],
) {
    vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: accounts })
        .mockResolvedValueOnce({ data: categories })
        .mockResolvedValueOnce({ data: transactions })
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
        // First two (accounts + categories) resolve; transactions never does.
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [] })
            .mockReturnValueOnce(new Promise<never>(() => {}))

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })

    it('shows an error message when the fetch fails', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [] })
            .mockRejectedValueOnce(new Error('Network error'))

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        expect(await screen.findByText(/could not load/i)).toBeInTheDocument()
    })

    it('shows an empty-state message when there are no transactions', async () => {
        mockFetch([], [], [])

        render(<MemoryRouter><TransactionsPage /></MemoryRouter>)

        expect(await screen.findByText(/no transactions/i)).toBeInTheDocument()
    })

    it('renders a list of transactions after a successful fetch', async () => {
        mockFetch(
            [makeAccount({ id: 'acc-001', name: 'Current Account' })],
            [makeCategory({ id: 'cat-001', name: 'Groceries' })],
            [makeTransaction({ payee: 'Tesco', amount: '45.50', status: 'pending', transaction_type: 'expense' })],
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
            [makeCategory()],
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
        mockFetch([makeAccount()], [makeCategory()], [makeTransaction({ status: 'cleared' })])
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
        mockFetch([makeAccount()], [makeCategory()], [makeTransaction({ status: 'reconciled' })])
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
        // Initial load + filtered re-fetch (each needs 3 mocked responses)
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount({ id: 'acc-001', name: 'Current' })] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
            .mockResolvedValueOnce({ data: [] })  // initial transactions
            .mockResolvedValueOnce({ data: [makeAccount({ id: 'acc-001', name: 'Current' })] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
            .mockResolvedValueOnce({ data: [] })  // filtered transactions

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
        // Initial load: empty list
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
            .mockResolvedValueOnce({ data: [] })
        // AddTransactionForm's own account/category fetch
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
        // Post succeeds
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })
        // Re-fetch after add: one transaction now
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
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
})
