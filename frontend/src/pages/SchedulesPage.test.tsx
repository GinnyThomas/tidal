// pages/SchedulesPage.test.tsx
//
// Purpose: Tests for SchedulesPage — the recurring schedules list view.
//
// Test strategy:
//   Four render states (loading, error, empty, list), active toggle,
//   and form toggle for Add Schedule.
//
// Three axios.get calls happen on mount: accounts, categories, schedules.
// Mocks must be queued in that order.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import SchedulesPage from './SchedulesPage'
import { getApiBaseUrl } from '../lib/api'

vi.mock('axios')

const makeAccount = (overrides = {}) => ({
    id: 'acc-001',
    name: 'Current Account',
    account_type: 'checking',
    currency: 'GBP',
    current_balance: '1500.00',
    institution: null,
    is_active: true,
    ...overrides,
})

const makeCategory = (overrides = {}) => ({
    id: 'cat-001',
    name: 'Bills',
    parent_category_id: null,
    ...overrides,
})

const makeSchedule = (overrides = {}) => ({
    id: 'sch-001',
    name: 'Netflix',
    account_id: 'acc-001',
    category_id: 'cat-001',
    amount: '15.99',
    currency: 'GBP',
    frequency: 'monthly',
    interval: 1,
    day_of_month: 1,
    start_date: '2026-01-01',
    end_date: null,
    next_occurrence: '2026-05-01',
    auto_generate: true,
    is_active: true,
    payee: null,
    note: null,
    ...overrides,
})

// Helper: queue the three standard mocks (accounts, categories, schedules)
function mockFetch(
    accounts = [makeAccount()],
    categories = [makeCategory()],
    schedules: ReturnType<typeof makeSchedule>[] = [],
) {
    vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: accounts })
        .mockResolvedValueOnce({ data: categories })
        .mockResolvedValueOnce({ data: schedules })
}

describe('SchedulesPage', () => {
    beforeEach(() => {
        localStorage.setItem('access_token', 'fake-token')
    })

    afterEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    // =========================================================================
    // Render states
    // =========================================================================

    it('shows a loading indicator while the fetch is in progress', () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [] })
            .mockReturnValueOnce(new Promise<never>(() => {}))

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })

    it('shows an error message when the fetch fails', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [] })
            .mockRejectedValueOnce(new Error('Network error'))

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        expect(await screen.findByText(/could not load/i)).toBeInTheDocument()
    })

    it('shows an empty-state message when there are no schedules', async () => {
        mockFetch([], [], [])

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        expect(await screen.findByText(/no schedules/i)).toBeInTheDocument()
    })

    it('renders a list of schedules after a successful fetch', async () => {
        mockFetch(
            [makeAccount({ id: 'acc-001', name: 'Current Account' })],
            [makeCategory({ id: 'cat-001', name: 'Bills' })],
            [makeSchedule({ name: 'Netflix', amount: '15.99', frequency: 'monthly', next_occurrence: '2026-05-01', is_active: true })],
        )

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        expect(await screen.findByText('Netflix')).toBeInTheDocument()
        expect(screen.getByText(/15\.99/)).toBeInTheDocument()
        expect(screen.getByText('monthly')).toBeInTheDocument()
        expect(screen.getByText('2026-05-01')).toBeInTheDocument()
        // Account and category names also appear as <option> text in the filter
        // dropdowns — use selector:'td' to match only the table cell occurrences.
        expect(screen.getByText('Current Account', { selector: 'td' })).toBeInTheDocument()
        expect(screen.getByText('Bills', { selector: 'td' })).toBeInTheDocument()
        // Active badge is a button (enables click-to-toggle)
        expect(screen.getByRole('button', { name: /^active$/i })).toBeInTheDocument()
    })

    // =========================================================================
    // Active toggle
    // =========================================================================

    it('toggles a schedule from active to inactive when the badge is clicked', async () => {
        mockFetch(
            [makeAccount()],
            [makeCategory()],
            [makeSchedule({ id: 'sch-001', is_active: true })],
        )
        vi.mocked(axios.patch).mockResolvedValueOnce({ data: {} })

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        const badge = await screen.findByRole('button', { name: /^active$/i })
        await userEvent.click(badge)

        await waitFor(() => {
            expect(vi.mocked(axios.patch)).toHaveBeenCalledWith(
                `${getApiBaseUrl()}/api/v1/schedules/sch-001/toggle-active`,
                {},
                expect.objectContaining({ headers: { Authorization: 'Bearer fake-token' } })
            )
        })

        // Optimistic update: badge now shows "Inactive"
        expect(await screen.findByRole('button', { name: /inactive/i })).toBeInTheDocument()
    })

    it('toggles a schedule from inactive to active when the badge is clicked', async () => {
        mockFetch(
            [makeAccount()],
            [makeCategory()],
            [makeSchedule({ id: 'sch-001', is_active: false })],
        )
        vi.mocked(axios.patch).mockResolvedValueOnce({ data: {} })

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        await userEvent.click(await screen.findByRole('button', { name: /inactive/i }))

        await waitFor(() => {
            expect(vi.mocked(axios.patch)).toHaveBeenCalledWith(
                expect.stringContaining('/api/v1/schedules/sch-001/toggle-active'),
                {},
                expect.anything()
            )
        })

        // Optimistic update: badge now shows "Active"
        expect(await screen.findByRole('button', { name: /^active$/i })).toBeInTheDocument()
    })

    // =========================================================================
    // Add Schedule form
    // =========================================================================

    it('shows the Add Schedule button once loaded', async () => {
        mockFetch()

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        expect(await screen.findByRole('button', { name: /add schedule/i })).toBeInTheDocument()
    })

    it('shows AddScheduleForm when Add Schedule is clicked', async () => {
        mockFetch()
        vi.mocked(axios.get).mockResolvedValue({ data: [] })

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        await userEvent.click(await screen.findByRole('button', { name: /add schedule/i }))

        // The form's frequency select is a distinctive field
        expect(screen.getByLabelText(/^frequency$/i)).toBeInTheDocument()
    })

    it('hides AddScheduleForm when Add Schedule is clicked a second time', async () => {
        mockFetch()

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        const btn = await screen.findByRole('button', { name: /add schedule/i })
        await userEvent.click(btn)
        await userEvent.click(btn)

        expect(screen.queryByLabelText(/^frequency$/i)).not.toBeInTheDocument()
    })

    // =========================================================================
    // Integration: schedule added triggers re-fetch
    // =========================================================================

    it('re-fetches and hides the form after a schedule is added', async () => {
        // Initial load: empty list
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
            .mockResolvedValueOnce({ data: [] })
        // AddScheduleForm's own account/category fetch
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
        // Post succeeds
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })
        // Re-fetch after add: one schedule now
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
            .mockResolvedValueOnce({ data: [makeSchedule({ name: 'Rent' })] })

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        await screen.findByText(/no schedules/i)

        await userEvent.click(screen.getByRole('button', { name: /add schedule/i }))

        // Wait for the form's dropdowns to populate
        await screen.findByRole('option', { name: 'Current Account' })
        await userEvent.type(screen.getByLabelText(/^name$/i), 'Rent')
        await userEvent.type(screen.getByLabelText(/^amount$/i), '900')
        await userEvent.click(screen.getByRole('button', { name: /save schedule/i }))

        expect(await screen.findByText('Rent')).toBeInTheDocument()
        // Form should be hidden
        expect(screen.queryByLabelText(/^frequency$/i)).not.toBeInTheDocument()
    })
})
