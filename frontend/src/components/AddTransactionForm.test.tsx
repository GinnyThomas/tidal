// components/AddTransactionForm.test.tsx
//
// Purpose: Tests for AddTransactionForm — the expense/income/refund form.
//
// Test strategy:
//   Verify: form renders with correct defaults, account and category dropdowns
//   are populated from the API, the parent_transaction_id field is conditional
//   on type=refund, the correct POST is made on submit, the callback fires on
//   success, and an error message appears on failure.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import AddTransactionForm from './AddTransactionForm'
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

describe('AddTransactionForm', () => {
    const mockOnTransactionAdded = vi.fn()

    beforeEach(() => {
        localStorage.setItem('access_token', 'fake-token')
        mockOnTransactionAdded.mockClear()
        // Default: resolve with empty arrays so every test that doesn't care
        // about dropdowns doesn't need to set up these mocks.
        vi.mocked(axios.get).mockResolvedValue({ data: [] })
    })

    afterEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    // =========================================================================
    // Rendering
    // =========================================================================

    it('renders all form fields with correct defaults', () => {
        render(<MemoryRouter><AddTransactionForm onTransactionAdded={mockOnTransactionAdded} /></MemoryRouter>)

        // Selects and inputs exist
        expect(screen.getByLabelText(/^account$/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/^category$/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/type/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/date/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/payee/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/amount/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/^currency$/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/status/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/note/i)).toBeInTheDocument()

        // Defaults
        expect(screen.getByLabelText(/^currency$/i)).toHaveValue('GBP')
        expect(screen.getByLabelText(/type/i)).toHaveValue('expense')
        expect(screen.getByLabelText(/status/i)).toHaveValue('pending')

        // Submit button
        expect(screen.getByRole('button', { name: /save transaction/i })).toBeInTheDocument()
    })

    it('renders three transaction type options — expense, income, refund (not transfer)', () => {
        render(<MemoryRouter><AddTransactionForm onTransactionAdded={mockOnTransactionAdded} /></MemoryRouter>)

        const select = screen.getByLabelText(/type/i)
        const options = Array.from((select as HTMLSelectElement).options).map(o => o.value)

        expect(options).toContain('expense')
        expect(options).toContain('income')
        expect(options).toContain('refund')
        expect(options).not.toContain('transfer') // transfers use AddTransferForm
    })

    it('populates account and category dropdowns from the API', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount({ name: 'Nationwide' })] })
            .mockResolvedValueOnce({ data: [makeCategory({ name: 'Groceries' })] })

        render(<MemoryRouter><AddTransactionForm onTransactionAdded={mockOnTransactionAdded} /></MemoryRouter>)

        // findBy waits for the async effect to populate the dropdowns
        expect(await screen.findByRole('option', { name: 'Nationwide' })).toBeInTheDocument()
        expect(await screen.findByRole('option', { name: 'Groceries' })).toBeInTheDocument()
    })

    // =========================================================================
    // Refund — conditional field
    // =========================================================================

    it('does not show the original transaction ID field for expense type', () => {
        render(<MemoryRouter><AddTransactionForm onTransactionAdded={mockOnTransactionAdded} /></MemoryRouter>)

        // expense is the default — the refund-specific field should not appear
        expect(screen.queryByLabelText(/original transaction/i)).not.toBeInTheDocument()
    })

    it('shows the original transaction ID field when type is refund', async () => {
        render(<MemoryRouter><AddTransactionForm onTransactionAdded={mockOnTransactionAdded} /></MemoryRouter>)

        await userEvent.selectOptions(screen.getByLabelText(/type/i), 'refund')

        expect(screen.getByLabelText(/original transaction/i)).toBeInTheDocument()
    })

    it('hides the original transaction ID field again when type switches away from refund', async () => {
        render(<MemoryRouter><AddTransactionForm onTransactionAdded={mockOnTransactionAdded} /></MemoryRouter>)

        await userEvent.selectOptions(screen.getByLabelText(/type/i), 'refund')
        await userEvent.selectOptions(screen.getByLabelText(/type/i), 'income')

        expect(screen.queryByLabelText(/original transaction/i)).not.toBeInTheDocument()
    })

    // =========================================================================
    // Submission
    // =========================================================================

    it('submits to the correct endpoint with the Authorization header', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })

        render(<MemoryRouter><AddTransactionForm onTransactionAdded={mockOnTransactionAdded} /></MemoryRouter>)

        // Wait for dropdowns so account_id is set
        await screen.findByRole('option', { name: 'Current Account' })

        // Explicitly select a category — no auto-select since "No category" is default
        await userEvent.selectOptions(screen.getByLabelText(/category/i), 'cat-001')
        await userEvent.type(screen.getByLabelText(/amount/i), '25.00')
        await userEvent.click(screen.getByRole('button', { name: /save transaction/i }))

        await waitFor(() => {
            expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
                `${getApiBaseUrl()}/api/v1/transactions`,
                expect.objectContaining({
                    account_id: 'acc-001',
                    category_id: 'cat-001',
                    transaction_type: 'expense',
                    status: 'pending',
                    currency: 'GBP',
                }),
                expect.objectContaining({
                    headers: { Authorization: 'Bearer fake-token' },
                })
            )
        })
    })

    it('calls onTransactionAdded after a successful submission', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })

        render(<MemoryRouter><AddTransactionForm onTransactionAdded={mockOnTransactionAdded} /></MemoryRouter>)

        await screen.findByRole('option', { name: 'Current Account' })
        await userEvent.type(screen.getByLabelText(/amount/i), '10')
        await userEvent.click(screen.getByRole('button', { name: /save transaction/i }))

        await waitFor(() => expect(mockOnTransactionAdded).toHaveBeenCalledTimes(1))
    })

    it('shows an error message when the submission fails', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
        vi.mocked(axios.post).mockRejectedValueOnce(new Error('Server error'))

        render(<MemoryRouter><AddTransactionForm onTransactionAdded={mockOnTransactionAdded} /></MemoryRouter>)

        await screen.findByRole('option', { name: 'Current Account' })
        await userEvent.type(screen.getByLabelText(/amount/i), '10')
        await userEvent.click(screen.getByRole('button', { name: /save transaction/i }))

        expect(await screen.findByText(/could not create transaction/i)).toBeInTheDocument()
        expect(mockOnTransactionAdded).not.toHaveBeenCalled()
    })

    // =========================================================================
    // Edit mode
    // =========================================================================

    const editingTransaction = {
        id: 'tx-edit-001',
        account_id: 'acc-001',
        category_id: 'cat-001',
        transaction_type: 'income',
        date: '2026-03-15',
        payee: 'Employer',
        amount: '2500.00',
        currency: 'EUR',
        status: 'cleared',
        note: 'March salary',
        parent_transaction_id: null,
    }

    it('pre-populates all fields in edit mode', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [makeCategory()] })

        render(
            <MemoryRouter>
                <AddTransactionForm
                    onTransactionAdded={mockOnTransactionAdded}
                    editingTransaction={editingTransaction}
                />
            </MemoryRouter>
        )

        // Wait for dropdowns to populate
        await screen.findByRole('option', { name: 'Current Account' })

        expect(screen.getByLabelText(/type/i)).toHaveValue('income')
        expect(screen.getByLabelText(/date/i)).toHaveValue('2026-03-15')
        expect(screen.getByLabelText(/payee/i)).toHaveValue('Employer')
        expect(screen.getByLabelText(/amount/i)).toHaveValue(2500)
        expect(screen.getByLabelText(/^currency$/i)).toHaveValue('EUR')
        expect(screen.getByLabelText(/status/i)).toHaveValue('cleared')
        expect(screen.getByLabelText(/note/i)).toHaveValue('March salary')
    })

    it('shows Edit Transaction heading and Update Transaction button in edit mode', () => {
        render(
            <MemoryRouter>
                <AddTransactionForm
                    onTransactionAdded={mockOnTransactionAdded}
                    editingTransaction={editingTransaction}
                />
            </MemoryRouter>
        )

        expect(screen.getByText('Edit Transaction')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /update transaction/i })).toBeInTheDocument()
    })

    it('submits PUT to the correct endpoint in edit mode', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
        vi.mocked(axios.put).mockResolvedValueOnce({ data: {} })
        const mockOnUpdated = vi.fn()

        render(
            <MemoryRouter>
                <AddTransactionForm
                    onTransactionAdded={mockOnTransactionAdded}
                    editingTransaction={editingTransaction}
                    onTransactionUpdated={mockOnUpdated}
                />
            </MemoryRouter>
        )

        await screen.findByRole('option', { name: 'Current Account' })
        await userEvent.click(screen.getByRole('button', { name: /update transaction/i }))

        await waitFor(() => {
            expect(vi.mocked(axios.put)).toHaveBeenCalledWith(
                `${getApiBaseUrl()}/api/v1/transactions/tx-edit-001`,
                expect.objectContaining({
                    transaction_type: 'income',
                    status: 'cleared',
                    currency: 'EUR',
                }),
                expect.objectContaining({
                    headers: { Authorization: 'Bearer fake-token' },
                })
            )
        })

        expect(mockOnUpdated).toHaveBeenCalledTimes(1)
        // The create callback should NOT have fired
        expect(mockOnTransactionAdded).not.toHaveBeenCalled()
    })

    it('pre-selects the account when defaultAccountId is provided', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({
                data: [
                    makeAccount({ id: 'acc-001', name: 'Current Account' }),
                    makeAccount({ id: 'acc-002', name: 'Savings' }),
                ],
            })
            .mockResolvedValueOnce({ data: [makeCategory()] })

        render(
            <MemoryRouter>
                <AddTransactionForm
                    onTransactionAdded={mockOnTransactionAdded}
                    defaultAccountId="acc-002"
                />
            </MemoryRouter>
        )

        // Wait for accounts to load
        await screen.findByRole('option', { name: 'Savings' })

        // The account dropdown should be pre-selected to acc-002, NOT
        // overwritten by the useEffect fallback to the first account.
        const accountSelect = screen.getByLabelText(/account/i) as HTMLSelectElement
        expect(accountSelect.value).toBe('acc-002')
    })
})
