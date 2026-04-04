// components/AddAccountForm.test.tsx
//
// Purpose: Tests for AddAccountForm — the account creation form.
//
// Test strategy:
//   We verify: the form renders with correct defaults, it calls the API
//   with the right payload and Authorization header, it calls the
//   onAccountAdded callback on success, and it shows an error on failure.
//
// The onAccountAdded prop is a vi.fn() so we can assert it was called.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import AddAccountForm from './AddAccountForm'
import { getApiBaseUrl } from '../lib/api'

vi.mock('axios')

describe('AddAccountForm', () => {
    const mockOnAccountAdded = vi.fn()

    beforeEach(() => {
        localStorage.setItem('access_token', 'fake-token')
        mockOnAccountAdded.mockClear()
    })

    afterEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    // =========================================================================
    // Rendering
    // =========================================================================

    it('renders all form fields with correct default values', () => {
        render(<MemoryRouter><AddAccountForm onAccountAdded={mockOnAccountAdded} /></MemoryRouter>)

        // Required fields
        expect(screen.getByLabelText(/account name/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/account type/i)).toBeInTheDocument()

        // Defaults
        expect(screen.getByLabelText(/currency/i)).toHaveValue('GBP')
        // Number inputs expose their value as a number via toHaveValue
        expect(screen.getByLabelText(/current balance/i)).toHaveValue(0)

        // Optional fields
        expect(screen.getByLabelText(/institution/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/note/i)).toBeInTheDocument()

        // Submit button
        expect(screen.getByRole('button', { name: /save account/i })).toBeInTheDocument()
    })

    it('renders all six account type options in the select', () => {
        render(<MemoryRouter><AddAccountForm onAccountAdded={mockOnAccountAdded} /></MemoryRouter>)

        const select = screen.getByLabelText(/account type/i)
        const options = Array.from((select as HTMLSelectElement).options).map(o => o.value)

        expect(options).toEqual(
            expect.arrayContaining(['checking', 'savings', 'credit_card', 'cash', 'mortgage', 'loan'])
        )
    })

    // =========================================================================
    // Submission
    // =========================================================================

    it('submits to the correct endpoint with the Authorization header', async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })

        render(<MemoryRouter><AddAccountForm onAccountAdded={mockOnAccountAdded} /></MemoryRouter>)

        await userEvent.type(screen.getByLabelText(/account name/i), 'My Current Account')
        await userEvent.click(screen.getByRole('button', { name: /save account/i }))

        await waitFor(() => {
            expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
                `${getApiBaseUrl()}/api/v1/accounts`,
                expect.objectContaining({
                    name: 'My Current Account',
                    account_type: 'checking', // default select value
                }),
                expect.objectContaining({
                    headers: { Authorization: 'Bearer fake-token' },
                })
            )
        })
    })

    it('calls onAccountAdded after a successful submission', async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })

        render(<MemoryRouter><AddAccountForm onAccountAdded={mockOnAccountAdded} /></MemoryRouter>)

        await userEvent.type(screen.getByLabelText(/account name/i), 'Test Account')
        await userEvent.click(screen.getByRole('button', { name: /save account/i }))

        await waitFor(() => expect(mockOnAccountAdded).toHaveBeenCalledTimes(1))
    })

    it('shows an error message when the submission fails', async () => {
        vi.mocked(axios.post).mockRejectedValueOnce(new Error('Server error'))

        render(<MemoryRouter><AddAccountForm onAccountAdded={mockOnAccountAdded} /></MemoryRouter>)

        await userEvent.type(screen.getByLabelText(/account name/i), 'Bad Account')
        await userEvent.click(screen.getByRole('button', { name: /save account/i }))

        expect(await screen.findByText(/could not create/i)).toBeInTheDocument()
        expect(mockOnAccountAdded).not.toHaveBeenCalled()
    })
})
