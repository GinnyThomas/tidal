import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import LoginPage from './LoginPage'
import axios from 'axios'

vi.mock('axios')

describe('LoginPage', () => {
    it('renders email and password fields and a submit button', () => {
        render(<MemoryRouter><LoginPage /></MemoryRouter>)
        expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument()
    })

    it('shows an error message when login fails', async () => {
        vi.mocked(axios.post).mockRejectedValueOnce(new Error('Invalid credentials'))
        render(<MemoryRouter><LoginPage /></MemoryRouter>)
        await userEvent.type(screen.getByLabelText(/email/i), 'test@test.com')
        await userEvent.type(screen.getByLabelText(/password/i), 'wrongpassword')
        await userEvent.click(screen.getByRole('button', { name: /log in/i }))
        expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument()
    })

    it('saves the token to localStorage on successful login', async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({
            data: { access_token: 'fake-jwt-token', token_type: 'bearer' }
        })
        render(<MemoryRouter><LoginPage /></MemoryRouter>)
        await userEvent.type(screen.getByLabelText(/email/i), 'test@test.com')
        await userEvent.type(screen.getByLabelText(/password/i), 'correctpassword')
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
        await userEvent.type(screen.getByLabelText(/password/i), 'correctpassword')
        await userEvent.click(screen.getByRole('button', { name: /log in/i }))
        expect(await screen.findByText('Dashboard')).toBeInTheDocument()
    })
})