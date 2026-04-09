// components/DemoButton.test.tsx
//
// Purpose: Tests for the DemoButton component.
//
// Three cases:
//   1. The button renders with the correct label.
//   2. Successful login navigates to /dashboard.
//   3. Failed login shows an error message.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import DemoButton from './DemoButton'

vi.mock('axios')

describe('DemoButton', () => {
    afterEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    it('renders a "Try Demo" button', () => {
        render(<MemoryRouter><DemoButton /></MemoryRouter>)
        expect(screen.getByRole('button', { name: /try demo/i })).toBeInTheDocument()
    })

    it('navigates to /dashboard on successful demo login', async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({
            data: { access_token: 'demo-token', token_type: 'bearer' },
        })
        render(
            <MemoryRouter initialEntries={['/login']}>
                <Routes>
                    <Route path="/login" element={<DemoButton />} />
                    <Route path="/dashboard" element={<p>Dashboard</p>} />
                </Routes>
            </MemoryRouter>
        )
        await userEvent.click(screen.getByRole('button', { name: /try demo/i }))
        expect(await screen.findByText('Dashboard')).toBeInTheDocument()
    })

    it('shows an error message when demo login fails', async () => {
        vi.mocked(axios.post).mockRejectedValueOnce(new Error('Network error'))
        render(<MemoryRouter><DemoButton /></MemoryRouter>)
        await userEvent.click(screen.getByRole('button', { name: /try demo/i }))
        expect(await screen.findByText(/demo account not available/i)).toBeInTheDocument()
    })
})
