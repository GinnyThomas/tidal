// components/AddTransferForm.test.tsx
//
// Purpose: Tests for AddTransferForm — the transfer-between-accounts form.
//
// Test strategy:
//   Verify: from/to account and category dropdowns are present and populated,
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
    institution: null,
    is_active: true,
    ...overrides,
})

const makeCategory = (overrides = {}) => ({
    id: 'cat-001',
    name: 'Transfers',
    parent_category_id: null,
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

    // =========================================================================
    // Rendering
    // =========================================================================

    it('renders all transfer form fields', () => {
        render(<MemoryRouter><AddTransferForm onTransactionAdded={mockOnTransactionAdded} /></MemoryRouter>)

        expect(screen.getByLabelText(/from account/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/to account/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/^category$/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/date/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/amount/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/^currency$/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/note/i)).toBeInTheDocument()

        expect(screen.getByLabelText(/^currency$/i)).toHaveValue('GBP')
        expect(screen.getByRole('button', { name: /save transfer/i })).toBeInTheDocument()
    })

    it('populates from/to account and category dropdowns from the API', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount({ id: 'acc-001', name: 'Nationwide' }), makeAccount({ id: 'acc-002', name: 'Savings' })] })
            .mockResolvedValueOnce({ data: [makeCategory({ name: 'Transfers' })] })

        render(<MemoryRouter><AddTransferForm onTransactionAdded={mockOnTransactionAdded} /></MemoryRouter>)

        // The same account names appear in BOTH the from and to selects,
        // so findAllByRole (plural) is correct here — we expect 2 occurrences.
        const nationwideOptions = await screen.findAllByRole('option', { name: 'Nationwide' })
        expect(nationwideOptions.length).toBe(2) // one per select
        expect(await screen.findByRole('option', { name: 'Transfers' })).toBeInTheDocument()
    })

    // =========================================================================
    // Submission
    // =========================================================================

    it('submits to the /transfer endpoint with the Authorization header', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount({ id: 'acc-001', name: 'Current' }), makeAccount({ id: 'acc-002', name: 'Savings' })] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })

        render(<MemoryRouter><AddTransferForm onTransactionAdded={mockOnTransactionAdded} /></MemoryRouter>)

        // "Current" appears in both from and to selects — use findAll and wait for 2
        await waitFor(() => expect(screen.getAllByRole('option', { name: 'Current' }).length).toBe(2))

        await userEvent.type(screen.getByLabelText(/amount/i), '100')
        await userEvent.click(screen.getByRole('button', { name: /save transfer/i }))

        await waitFor(() => {
            expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
                `${getApiBaseUrl()}/api/v1/transactions/transfer`,
                expect.objectContaining({
                    from_account_id: 'acc-001',
                    to_account_id: 'acc-002',
                    category_id: 'cat-001',
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
            .mockResolvedValueOnce({ data: [makeAccount(), makeAccount({ id: 'acc-002', name: 'Savings' })] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })

        render(<MemoryRouter><AddTransferForm onTransactionAdded={mockOnTransactionAdded} /></MemoryRouter>)

        // Wait for options to appear in both selects (2 occurrences of 'Current Account')
        await waitFor(() => expect(screen.getAllByRole('option', { name: 'Current Account' }).length).toBe(2))
        await userEvent.type(screen.getByLabelText(/amount/i), '50')
        await userEvent.click(screen.getByRole('button', { name: /save transfer/i }))

        await waitFor(() => expect(mockOnTransactionAdded).toHaveBeenCalledTimes(1))
    })

    it('shows an error message when the submission fails', async () => {
        // Two accounts so toAccountId gets auto-set (avoids HTML5 required blocking submit)
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount(), makeAccount({ id: 'acc-002', name: 'Savings' })] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
        vi.mocked(axios.post).mockRejectedValueOnce(new Error('Server error'))

        render(<MemoryRouter><AddTransferForm onTransactionAdded={mockOnTransactionAdded} /></MemoryRouter>)

        await waitFor(() => expect(screen.getAllByRole('option', { name: 'Current Account' }).length).toBe(2))
        await userEvent.type(screen.getByLabelText(/amount/i), '50')
        await userEvent.click(screen.getByRole('button', { name: /save transfer/i }))

        expect(await screen.findByText(/could not create transfer/i)).toBeInTheDocument()
        expect(mockOnTransactionAdded).not.toHaveBeenCalled()
    })
})
