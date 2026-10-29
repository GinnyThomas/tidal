import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
import LoginPage from './LoginPage'
import axios from 'axios'

vi.mock('axios')

describe('LoginPage', () => {
    afterEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    it('renders email and password fields and a submit button', () => {
        render(<MemoryRouter><LoginPage /></MemoryRouter>)
        expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
        // Use anchored regex — /^password$/i matches "Password" but NOT
        // "Show password" (the toggle button's aria-label).
        expect(screen.getByLabelText(/^password$/i, { selector: 'input' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument()
    })

    it('shows an error message when login fails', async () => {
        vi.mocked(axios.post).mockRejectedValueOnce({ response: { status: 401 } })
        render(<MemoryRouter><LoginPage /></MemoryRouter>)
        await userEvent.type(screen.getByLabelText(/email/i), 'test@test.com')
        await userEvent.type(screen.getByLabelText(/^password$/i, { selector: 'input' }), 'wrongpassword')
        await userEvent.click(screen.getByRole('button', { name: /log in/i }))
        expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument()
    })

    it('shows a generic error, not "invalid credentials", when the server fails', async () => {
        // e.g. the backend can't reach the database → 500
        vi.mocked(axios.post).mockRejectedValueOnce({ response: { status: 500 } })
        render(<MemoryRouter><LoginPage /></MemoryRouter>)
        await userEvent.type(screen.getByLabelText(/email/i), 'test@test.com')
        await userEvent.type(screen.getByLabelText(/^password$/i, { selector: 'input' }), 'correctpassword')
        await userEvent.click(screen.getByRole('button', { name: /log in/i }))
        expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
        expect(screen.queryByText(/invalid credentials/i)).not.toBeInTheDocument()
    })

    it('says the email is not valid, not "try again", when the server rejects its format', async () => {
        // The browser accepts some addresses (e.g. ginny@localhost) that the backend's EmailStr rejects → 422
        vi.mocked(axios.post).mockRejectedValueOnce({ response: { status: 422 } })
        render(<MemoryRouter><LoginPage /></MemoryRouter>)
        await userEvent.type(screen.getByLabelText(/email/i), 'ginny@localhost')
        await userEvent.type(screen.getByLabelText(/^password$/i, { selector: 'input' }), 'somepassword')
        await userEvent.click(screen.getByRole('button', { name: /log in/i }))
        expect(await screen.findByText(/valid email address/i)).toBeInTheDocument()
        expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
    })

    it('shows a generic error when the server cannot be reached', async () => {
        vi.mocked(axios.post).mockRejectedValueOnce(new Error('Network Error'))
        render(<MemoryRouter><LoginPage /></MemoryRouter>)
        await userEvent.type(screen.getByLabelText(/email/i), 'test@test.com')
        await userEvent.type(screen.getByLabelText(/^password$/i, { selector: 'input' }), 'correctpassword')
        await userEvent.click(screen.getByRole('button', { name: /log in/i }))
        expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    })

    it('saves the token to localStorage on successful login', async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({
            data: { access_token: 'fake-jwt-token', token_type: 'bearer' }
        })
        render(<MemoryRouter><LoginPage /></MemoryRouter>)
        await userEvent.type(screen.getByLabelText(/email/i), 'test@test.com')
        await userEvent.type(screen.getByLabelText(/^password$/i, { selector: 'input' }), 'correctpassword')
        await userEvent.click(screen.getByRole('button', { name: /log in/i }))
        await waitFor(() => {
            expect(localStorage.getItem('access_token')).toBe('fake-jwt-token')
        })
    })

    it('redirects to dashboard after successful login', async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({
            data: { access_token: 'fake-jwt-token', token_type: 'bearer' }
        })
        render(
            <MemoryRouter initialEntries={['/login']}>
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/dashboard" element={<p>Dashboard</p>} />
                </Routes>
            </MemoryRouter>
        )
        await userEvent.type(screen.getByLabelText(/email/i), 'test@test.com')
        await userEvent.type(screen.getByLabelText(/^password$/i, { selector: 'input' }), 'correctpassword')
        await userEvent.click(screen.getByRole('button', { name: /log in/i }))
        expect(await screen.findByText('Dashboard')).toBeInTheDocument()
    })

    // =========================================================================
    // Show/hide password toggle
    // =========================================================================

    it('toggles the password field between password and text type', async () => {
        render(<MemoryRouter><LoginPage /></MemoryRouter>)
        const field = screen.getByLabelText(/^password$/i, { selector: 'input' })
        expect(field).toHaveAttribute('type', 'password')
        await userEvent.click(screen.getByLabelText(/show password/i))
        expect(field).toHaveAttribute('type', 'text')
        // Clicking again hides it
        await userEvent.click(screen.getByLabelText(/hide password/i))
        expect(field).toHaveAttribute('type', 'password')
    })

    // =========================================================================
    // Demo button
    // =========================================================================

    it('renders a Try Demo button', () => {
        render(<MemoryRouter><LoginPage /></MemoryRouter>)
        expect(screen.getByRole('button', { name: /try demo/i })).toBeInTheDocument()
    })

    // =========================================================================
    // Forgot password
    // =========================================================================

    it('links to the forgot password page', () => {
        render(<MemoryRouter><LoginPage /></MemoryRouter>)
        expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute('href', '/forgot-password')
    })

    it('shows a success message when arriving from a password reset', () => {
        render(
            <MemoryRouter initialEntries={[{ pathname: '/login', state: { passwordReset: true } }]}>
                <LoginPage />
            </MemoryRouter>
        )
        expect(screen.getByText(/password updated/i)).toBeInTheDocument()
    })

    it('clears the reset flag from history so a reload or Back does not show it again', async () => {
        // Renders the router's current location.state next to the page.
        function LocationStateProbe() {
            return <p data-testid="location-state">{JSON.stringify(useLocation().state)}</p>
        }
        render(
            <MemoryRouter initialEntries={[{ pathname: '/login', state: { passwordReset: true } }]}>
                <LoginPage />
                <LocationStateProbe />
            </MemoryRouter>
        )
        await waitFor(() => {
            expect(screen.getByTestId('location-state')).toHaveTextContent('null')
        })
        // The banner is still showing for this visit.
        expect(screen.getByText(/password updated/i)).toBeInTheDocument()
    })

    it('does not show the success message on a normal visit', () => {
        render(<MemoryRouter><LoginPage /></MemoryRouter>)
        expect(screen.queryByText(/password updated/i)).not.toBeInTheDocument()
    })
})
