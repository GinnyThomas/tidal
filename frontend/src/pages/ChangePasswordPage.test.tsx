// pages/ChangePasswordPage.test.tsx
//
// Purpose: Tests for ChangePasswordPage.
//
// Test strategy — five cases:
//   1. Three password fields and a submit button render.
//   2. Mismatched new passwords show a client-side error (no API call).
//   3. Correct input → API succeeds → success message shown.
//   4. API returns 400 (wrong current password) → error message shown.
//   5. Show/hide toggle changes the input type for the current password field.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import ChangePasswordPage from './ChangePasswordPage'

vi.mock('axios')

describe('ChangePasswordPage', () => {
    beforeEach(() => {
        localStorage.setItem('access_token', 'fake-token')
    })

    afterEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    it('renders three password fields and a submit button', () => {
        render(<MemoryRouter><ChangePasswordPage /></MemoryRouter>)
        expect(screen.getByLabelText(/current password/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /change password/i })).toBeInTheDocument()
    })

    it('shows an error when new passwords do not match', async () => {
        render(<MemoryRouter><ChangePasswordPage /></MemoryRouter>)
        await userEvent.type(screen.getByLabelText(/current password/i), 'oldpass123')
        await userEvent.type(screen.getByLabelText(/^new password$/i), 'newpass123')
        await userEvent.type(screen.getByLabelText(/confirm new password/i), 'different123')
        await userEvent.click(screen.getByRole('button', { name: /change password/i }))
        expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument()
    })

    it('shows a success message after a successful password change', async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })
        render(<MemoryRouter><ChangePasswordPage /></MemoryRouter>)
        await userEvent.type(screen.getByLabelText(/current password/i), 'oldpass123')
        await userEvent.type(screen.getByLabelText(/^new password$/i), 'newpass456')
        await userEvent.type(screen.getByLabelText(/confirm new password/i), 'newpass456')
        await userEvent.click(screen.getByRole('button', { name: /change password/i }))
        expect(await screen.findByText(/password changed/i)).toBeInTheDocument()
    })

    it('shows the API error when the current password is wrong', async () => {
        vi.mocked(axios.post).mockRejectedValueOnce({
            response: { data: { detail: 'Current password is incorrect.' } },
        })
        render(<MemoryRouter><ChangePasswordPage /></MemoryRouter>)
        await userEvent.type(screen.getByLabelText(/current password/i), 'wrongpass')
        await userEvent.type(screen.getByLabelText(/^new password$/i), 'newpass456')
        await userEvent.type(screen.getByLabelText(/confirm new password/i), 'newpass456')
        await userEvent.click(screen.getByRole('button', { name: /change password/i }))
        expect(await screen.findByText(/current password is incorrect/i)).toBeInTheDocument()
    })

    it('toggles the current password field between password and text', async () => {
        render(<MemoryRouter><ChangePasswordPage /></MemoryRouter>)
        const field = screen.getByLabelText(/current password/i)
        expect(field).toHaveAttribute('type', 'password')
        // All three toggle buttons initially show "Show password" aria-label.
        // [0] is the current password toggle.
        await userEvent.click(screen.getAllByLabelText(/show password/i)[0])
        expect(field).toHaveAttribute('type', 'text')
    })
})
