import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import ResetPasswordPage from './ResetPasswordPage'
import LoginPage from './LoginPage'
import axios from 'axios'

vi.mock('axios')

function renderAt(url: string) {
    return render(
        <MemoryRouter initialEntries={[url]}>
            <Routes>
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/login" element={<LoginPage />} />
            </Routes>
        </MemoryRouter>
    )
}

async function fillAndSubmit(newPassword: string, confirm: string) {
    await userEvent.type(screen.getByLabelText(/^new password$/i, { selector: 'input' }), newPassword)
    await userEvent.type(screen.getByLabelText(/^confirm new password$/i, { selector: 'input' }), confirm)
    await userEvent.click(screen.getByRole('button', { name: /reset password/i }))
}

describe('ResetPasswordPage', () => {
    afterEach(() => {
        vi.clearAllMocks()
    })

    it('renders new and confirm password fields', () => {
        renderAt('/reset-password?token=abc123')
        expect(screen.getByLabelText(/^new password$/i, { selector: 'input' })).toBeInTheDocument()
        expect(screen.getByLabelText(/^confirm new password$/i, { selector: 'input' })).toBeInTheDocument()
    })

    it('shows an invalid-link message and no form when the token is missing', () => {
        renderAt('/reset-password')
        expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /reset password/i })).not.toBeInTheDocument()
        expect(screen.getByRole('link', { name: /request a new link/i })).toHaveAttribute('href', '/forgot-password')
    })

    it('does not call the API when the passwords do not match', async () => {
        renderAt('/reset-password?token=abc123')
        await fillAndSubmit('brandnewpassword', 'different')
        expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument()
        expect(axios.post).not.toHaveBeenCalled()
    })

    it('posts the token and new password to the reset endpoint', async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ status: 204 })
        renderAt('/reset-password?token=abc123')
        await fillAndSubmit('brandnewpassword', 'brandnewpassword')
        expect(axios.post).toHaveBeenCalledWith(
            expect.stringContaining('/api/v1/auth/reset-password'),
            { token: 'abc123', new_password: 'brandnewpassword' }
        )
    })

    it('redirects to login with a success message after resetting', async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ status: 204 })
        renderAt('/reset-password?token=abc123')
        await fillAndSubmit('brandnewpassword', 'brandnewpassword')
        expect(await screen.findByText(/password updated/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument()
    })

    it('shows the API error and a link to request a new one when the token is rejected', async () => {
        vi.mocked(axios.post).mockRejectedValueOnce({
            response: { data: { detail: 'This reset link is invalid or has expired.' } },
        })
        renderAt('/reset-password?token=stale')
        await fillAndSubmit('brandnewpassword', 'brandnewpassword')
        expect(await screen.findByText('This reset link is invalid or has expired.')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: /request a new link/i })).toHaveAttribute('href', '/forgot-password')
    })
})
