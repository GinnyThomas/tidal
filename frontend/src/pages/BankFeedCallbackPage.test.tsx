// pages/BankFeedCallbackPage.test.tsx

import { render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import BankFeedCallbackPage from './BankFeedCallbackPage'

vi.mock('axios')

const renderAt = (url: string) => render(
    <StrictMode>
        <MemoryRouter initialEntries={[url]}>
            <Routes>
                <Route path="/bank-feeds/callback" element={<BankFeedCallbackPage />} />
                <Route path="/bank-feeds" element={<p>Bank feeds page</p>} />
            </Routes>
        </MemoryRouter>
    </StrictMode>
)

describe('BankFeedCallbackPage', () => {
    beforeEach(() => {
        localStorage.setItem('access_token', 'fake-token')
    })

    afterEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    it('completes the connection with the code and state from the bank', async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ data: { id: 'conn-1' } })
        renderAt('/bank-feeds/callback?code=abc&state=xyz')
        expect(await screen.findByText('Bank feeds page')).toBeInTheDocument()
        expect(axios.post).toHaveBeenCalledWith(
            expect.stringContaining('/api/v1/bank-feeds/connections/complete'),
            { code: 'abc', state: 'xyz' },
            expect.anything(),
        )
    })

    it('posts only once, even when React runs effects twice', async () => {
        // The state is single use — a second POST would fail with 404.
        vi.mocked(axios.post).mockResolvedValue({ data: { id: 'conn-1' } })
        renderAt('/bank-feeds/callback?code=abc&state=xyz')
        await screen.findByText('Bank feeds page')
        expect(axios.post).toHaveBeenCalledTimes(1)
    })

    it('shows the bank error when consent was refused', async () => {
        renderAt('/bank-feeds/callback?error=access_denied&error_description=User+cancelled')
        expect(await screen.findByText(/user cancelled/i)).toBeInTheDocument()
        expect(axios.post).not.toHaveBeenCalled()
    })

    it('shows an error when the code or state is missing', async () => {
        renderAt('/bank-feeds/callback')
        expect(await screen.findByText(/link is incomplete/i)).toBeInTheDocument()
        expect(axios.post).not.toHaveBeenCalled()
    })

    it('shows an error when completing fails', async () => {
        vi.mocked(axios.post).mockRejectedValueOnce({ response: { status: 404 } })
        renderAt('/bank-feeds/callback?code=abc&state=xyz')
        expect(await screen.findByText(/could not finish connecting/i)).toBeInTheDocument()
        expect(screen.getByRole('link', { name: /back to bank feeds/i })).toHaveAttribute('href', '/bank-feeds')
    })
})
