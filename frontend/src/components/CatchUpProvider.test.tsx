import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import CatchUpProvider from './CatchUpProvider'

vi.mock('axios')

describe('CatchUpProvider', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    afterEach(() => {
        localStorage.clear()
        vi.resetAllMocks()
    })

    it('calls catch-up endpoint on first load (no localStorage entry)', async () => {
        localStorage.setItem('access_token', 'fake-token')
        vi.mocked(axios.post).mockResolvedValueOnce({ data: { count: 0, created: [] } })

        render(
            <MemoryRouter>
                <CatchUpProvider><p>Content</p></CatchUpProvider>
            </MemoryRouter>
        )

        await waitFor(() => {
            expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
                expect.stringContaining('/api/v1/schedules/catch-up'),
                {},
                expect.anything()
            )
        })
    })

    it('does NOT call catch-up when localStorage matches today', async () => {
        localStorage.setItem('access_token', 'fake-token')
        localStorage.setItem('tidal_last_catchup', new Date().toISOString().split('T')[0])

        render(
            <MemoryRouter>
                <CatchUpProvider><p>Content</p></CatchUpProvider>
            </MemoryRouter>
        )

        await screen.findByText('Content')
        expect(vi.mocked(axios.post)).not.toHaveBeenCalled()
    })

    it('calls catch-up when localStorage has stale date', async () => {
        localStorage.setItem('access_token', 'fake-token')
        localStorage.setItem('tidal_last_catchup', '2026-01-01')
        vi.mocked(axios.post).mockResolvedValueOnce({ data: { count: 0, created: [] } })

        render(
            <MemoryRouter>
                <CatchUpProvider><p>Content</p></CatchUpProvider>
            </MemoryRouter>
        )

        await waitFor(() => {
            expect(vi.mocked(axios.post)).toHaveBeenCalled()
        })
    })

    it('shows toast when count > 0', async () => {
        localStorage.setItem('access_token', 'fake-token')
        vi.mocked(axios.post).mockResolvedValueOnce({ data: { count: 3, created: [] } })

        render(
            <MemoryRouter>
                <CatchUpProvider><p>Content</p></CatchUpProvider>
            </MemoryRouter>
        )

        expect(await screen.findByText(/created 3 pending transactions/i)).toBeInTheDocument()
        expect(screen.getByText('View')).toBeInTheDocument()
    })

    it('does not show toast when count === 0', async () => {
        localStorage.setItem('access_token', 'fake-token')
        vi.mocked(axios.post).mockResolvedValueOnce({ data: { count: 0, created: [] } })

        render(
            <MemoryRouter>
                <CatchUpProvider><p>Content</p></CatchUpProvider>
            </MemoryRouter>
        )

        await screen.findByText('Content')
        expect(screen.queryByText(/created.*pending transactions/i)).not.toBeInTheDocument()
    })

    it('View link navigates to filtered transactions page', async () => {
        localStorage.setItem('access_token', 'fake-token')
        vi.mocked(axios.post).mockResolvedValueOnce({ data: { count: 2, created: [] } })

        render(
            <MemoryRouter initialEntries={['/dashboard']}>
                <CatchUpProvider>
                    <Routes>
                        <Route path="/dashboard" element={<p>Dashboard</p>} />
                        <Route path="/transactions" element={<p>Transactions Page</p>} />
                    </Routes>
                </CatchUpProvider>
            </MemoryRouter>
        )

        await screen.findByText(/created 2 pending/i)
        await userEvent.click(screen.getByText('View'))

        expect(await screen.findByText('Transactions Page')).toBeInTheDocument()
    })

    it('on catch-up failure, app loads normally and localStorage NOT updated', async () => {
        localStorage.setItem('access_token', 'fake-token')
        vi.mocked(axios.post).mockRejectedValueOnce(new Error('fail'))

        render(
            <MemoryRouter>
                <CatchUpProvider><p>Content</p></CatchUpProvider>
            </MemoryRouter>
        )

        expect(await screen.findByText('Content')).toBeInTheDocument()
        expect(localStorage.getItem('tidal_last_catchup')).toBeNull()
    })

    it('does not call catch-up when no token is present', async () => {
        render(
            <MemoryRouter>
                <CatchUpProvider><p>Content</p></CatchUpProvider>
            </MemoryRouter>
        )

        await screen.findByText('Content')
        expect(vi.mocked(axios.post)).not.toHaveBeenCalled()
    })
})
