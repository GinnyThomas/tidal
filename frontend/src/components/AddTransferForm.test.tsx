// components/AddTransferForm.test.tsx
//
// Purpose: Tests for AddTransferForm — the transfer-between-accounts form.
//
// Test strategy:
//   Verify: from/to account dropdowns are present and populated (no category),
//   the form submits to the /transfer endpoint, the callback fires on success,
//   and an error message appears on failure.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import AddTransferForm from './AddTransferForm'
import { getApiBaseUrl } from '../lib/api'

vi.mock('axios')

const makeAccount = (overrides = {}) => ({
    id: 'acc-001',
    name: 'Current Account',
    account_type: 'checking',
    currency: 'GBP',
    current_balance: '1500.00',
    calculated_balance: '1500.00',
    institution: null,
    is_active: true,
    note: null,
    ...overrides,
})

describe('AddTransferForm', () => {
    const mockOnTransactionAdded = vi.fn()

    beforeEach(() => {
        localStorage.setItem('access_token', 'fake-token')
        mockOnTransactionAdded.mockClear()
        vi.mocked(axios.get).mockResolvedValue({ data: [] })
    })

    afterEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    it('renders transfer form fields (no category dropdown)', () => {
        render(<MemoryRouter><AddTransferForm onTransactionAdded={mockOnTransactionAdded} /></MemoryRouter>)

        expect(screen.getByLabelText(/from account/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/to account/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/date/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/amount/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/^currency$/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/note/i)).toBeInTheDocument()
        // No category dropdown in transfer form
        expect(screen.queryByLabelText(/^category$/i)).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: /save transfer/i })).toBeInTheDocument()
    })

    it('populates from/to account dropdowns from the API', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: [makeAccount({ id: 'acc-001', name: 'Nationwide' }), makeAccount({ id: 'acc-002', name: 'Savings' })],
        })

        render(<MemoryRouter><AddTransferForm onTransactionAdded={mockOnTransactionAdded} /></MemoryRouter>)

        const nationwideOptions = await screen.findAllByRole('option', { name: 'Nationwide' })
        expect(nationwideOptions.length).toBe(2) // one per select
    })

    it('submits to the /transfer endpoint without category_id', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: [makeAccount({ id: 'acc-001', name: 'Current' }), makeAccount({ id: 'acc-002', name: 'Savings' })],
        })
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })

        render(<MemoryRouter><AddTransferForm onTransactionAdded={mockOnTransactionAdded} /></MemoryRouter>)

        await waitFor(() => expect(screen.getAllByRole('option', { name: 'Current' }).length).toBe(2))
        await userEvent.type(screen.getByLabelText(/amount/i), '100')
        await userEvent.click(screen.getByRole('button', { name: /save transfer/i }))

        await waitFor(() => {
            expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
                `${getApiBaseUrl()}/api/v1/transactions/transfer`,
                expect.objectContaining({
                    from_account_id: 'acc-001',
                    to_account_id: 'acc-002',
                }),
                expect.objectContaining({
                    headers: { Authorization: 'Bearer fake-token' },
                })
            )
            // No category_id in payload
            const payload = vi.mocked(axios.post).mock.calls[0][1]
            expect(payload).not.toHaveProperty('category_id')
        })
    })

    it('calls onTransactionAdded after a successful submission', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: [makeAccount(), makeAccount({ id: 'acc-002', name: 'Savings' })],
        })
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })

        render(<MemoryRouter><AddTransferForm onTransactionAdded={mockOnTransactionAdded} /></MemoryRouter>)

        await waitFor(() => expect(screen.getAllByRole('option', { name: 'Current Account' }).length).toBe(2))
        await userEvent.type(screen.getByLabelText(/amount/i), '50')
        await userEvent.click(screen.getByRole('button', { name: /save transfer/i }))

        await waitFor(() => expect(mockOnTransactionAdded).toHaveBeenCalledTimes(1))
    })

    it('shows an error message when the submission fails', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: [makeAccount(), makeAccount({ id: 'acc-002', name: 'Savings' })],
        })
        vi.mocked(axios.post).mockRejectedValueOnce(new Error('Server error'))

        render(<MemoryRouter><AddTransferForm onTransactionAdded={mockOnTransactionAdded} /></MemoryRouter>)

        await waitFor(() => expect(screen.getAllByRole('option', { name: 'Current Account' }).length).toBe(2))
        await userEvent.type(screen.getByLabelText(/amount/i), '50')
        await userEvent.click(screen.getByRole('button', { name: /save transfer/i }))

        expect(await screen.findByText(/could not create transfer/i)).toBeInTheDocument()
        expect(mockOnTransactionAdded).not.toHaveBeenCalled()
    })

    it('pre-selects the from account when defaultAccountId is provided', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: [
                makeAccount({ id: 'acc-001', name: 'Current' }),
                makeAccount({ id: 'acc-002', name: 'Savings' }),
                makeAccount({ id: 'acc-003', name: 'España' }),
            ],
        })

        // defaultAccountId = acc-002 → "From" should be acc-002, "To" should
        // be the first account that isn't acc-002 (i.e. acc-001).
        render(
            <MemoryRouter>
                <AddTransferForm onTransactionAdded={mockOnTransactionAdded} defaultAccountId="acc-002" />
            </MemoryRouter>
        )

        // Wait for the accounts fetch to resolve and the dropdowns to populate
        await waitFor(() => {
            const fromSelect = screen.getByLabelText(/from account/i) as HTMLSelectElement
            expect(fromSelect.value).toBe('acc-002')
        })

        const toSelect = screen.getByLabelText(/to account/i) as HTMLSelectElement
        // "To" must NOT match "From" — should pick acc-001 (first non-matching)
        expect(toSelect.value).toBe('acc-001')
    })

    it('shows Edit Transfer heading in edit mode', () => {
        const editing = {
            id: 'tx-1', account_id: 'acc-001', date: '2026-01-15',
            amount: '300.00', currency: 'GBP', note: null, parent_transaction_id: null,
        }
        render(<MemoryRouter><AddTransferForm onTransactionAdded={mockOnTransactionAdded} editingTransfer={editing} /></MemoryRouter>)

        expect(screen.getByText('Edit Transfer')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /update transfer/i })).toBeInTheDocument()
    })
})
