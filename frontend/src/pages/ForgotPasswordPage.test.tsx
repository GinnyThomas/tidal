import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import ForgotPasswordPage from './ForgotPasswordPage'
import axios from 'axios'

vi.mock('axios')

const CONFIRMATION = 'If an account exists for that email, a reset link is on its way.'

describe('ForgotPasswordPage', () => {
    afterEach(() => {
        vi.clearAllMocks()
    })

    it('renders an email field and a submit button', () => {
        render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>)
        expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument()
    })

    it('posts the email to the forgot-password endpoint', async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ data: { detail: CONFIRMATION } })
        render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>)
        await userEvent.type(screen.getByLabelText(/email/i), 'ginny@example.com')
        await userEvent.click(screen.getByRole('button', { name: /send reset link/i }))
        expect(axios.post).toHaveBeenCalledWith(
            expect.stringContaining('/api/v1/auth/forgot-password'),
            { email: 'ginny@example.com' }
        )
    })

    it('shows the confirmation message and hides the form after submitting', async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ data: { detail: CONFIRMATION } })
        render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>)
        await userEvent.type(screen.getByLabelText(/email/i), 'ginny@example.com')
        await userEvent.click(screen.getByRole('button', { name: /send reset link/i }))
        expect(await screen.findByText(CONFIRMATION)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /send reset link/i })).not.toBeInTheDocument()
    })

    it('shows an error when the request fails', async () => {
        vi.mocked(axios.post).mockRejectedValueOnce(new Error('Network Error'))
        render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>)
        await userEvent.type(screen.getByLabelText(/email/i), 'ginny@example.com')
        await userEvent.click(screen.getByRole('button', { name: /send reset link/i }))
        expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    })

    it('links back to the login page', () => {
        render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>)
        expect(screen.getByRole('link', { name: /back to log in/i })).toHaveAttribute('href', '/login')
    })
})
