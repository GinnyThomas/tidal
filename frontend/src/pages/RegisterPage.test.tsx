import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi } from 'vitest'
import RegisterPage from './RegisterPage'
import axios from 'axios'

vi.mock('axios')

describe('RegisterPage', () => {
    it('renders email, password fields and a register button', () => {
        render(<MemoryRouter><RegisterPage /></MemoryRouter>)
        expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /register/i })).toBeInTheDocument()
    })

    it('shows an error when password and verifyPassword do not match', async () => {
        render(<MemoryRouter><RegisterPage /></MemoryRouter>)
        await userEvent.type(screen.getByLabelText(/email/i), 'new@test.com')
        await userEvent.type(screen.getByLabelText(/^password$/i), 'password123')
        await userEvent.type(screen.getByLabelText(/confirm password/i), 'password113')
        await userEvent.click(screen.getByRole('button', { name: /register/i }))
        expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument()
    })

    it('shows an error when email already exists', async () => {
        vi.mocked(axios.post).mockRejectedValueOnce(new Error('Email already exists'))
        render(<MemoryRouter><RegisterPage /></MemoryRouter>)
        await userEvent.type(screen.getByLabelText(/email/i), 'existing@test.com')
        await userEvent.type(screen.getByLabelText(/^password$/i), 'password123')
        await userEvent.type(screen.getByLabelText(/confirm password/i), 'password123')
        await userEvent.click(screen.getByRole('button', { name: /register/i }))
        expect(await screen.findByText(/email already exists/i)).toBeInTheDocument()
    })

    it('toggles the password field between password and text type', async () => {
        render(<MemoryRouter><RegisterPage /></MemoryRouter>)
        const field = screen.getByLabelText(/^password$/i, { selector: 'input' })
        expect(field).toHaveAttribute('type', 'password')
        // Two toggle buttons exist initially (password + confirmPassword).
        // [0] is the password field toggle.
        await userEvent.click(screen.getAllByLabelText(/show password/i)[0])
        expect(field).toHaveAttribute('type', 'text')
    })

    it('renders a Try Demo button', () => {
        render(<MemoryRouter><RegisterPage /></MemoryRouter>)
        expect(screen.getByRole('button', { name: /try demo/i })).toBeInTheDocument()
    })

    it('logs in and redirects to dashboard after successful registration', async () => {
        vi.mocked(axios.post)
            .mockResolvedValueOnce({ data: { email: 'new@test.com' } })
            .mockResolvedValueOnce({ data: { access_token: 'fake-jwt-token', token_type: 'bearer' } })
        render(
            <MemoryRouter initialEntries={['/register']}>
                <Routes>
                    <Route path="/register" element={<RegisterPage />} />
                    <Route path="/dashboard" element={<p>Dashboard</p>} />
                </Routes>
            </MemoryRouter>
        )
        await userEvent.type(screen.getByLabelText(/email/i), 'new@test.com')
        await userEvent.type(screen.getByLabelText(/^password$/i), 'password123')
        await userEvent.type(screen.getByLabelText(/confirm password/i), 'password123')
        await userEvent.click(screen.getByRole('button', { name: /register/i }))
        expect(await screen.findByText('Dashboard')).toBeInTheDocument()
        await waitFor(() => {
            expect(localStorage.getItem('access_token')).toBe('fake-jwt-token')
        })
    })
})