// pages/SchedulesPage.test.tsx
//
// Purpose: Tests for SchedulesPage — the recurring schedules list view.
//
// Test strategy:
//   Four render states (loading, error, empty, list), active toggle,
//   Show Inactive toggle, and form toggle for Add Schedule.
//
// Two axios.get calls happen on mount: accounts, schedules.
// Mocks must be queued in that order. Categories are no longer fetched by
// the page — category_name comes directly from each schedule in the API response.

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
    category_name: 'Bills',
    category_icon: null,
    schedule_type: 'regular',
    amount: '15.99',
    currency: 'GBP',
    frequency: 'monthly',
    interval: 1,
    day_of_month: 1,
    start_date: '2026-01-01',
    end_date: null,
    next_occurrence: '2026-05-01',
    auto_generate: true,
    active: true,
    group: null,
    payee: null,
    note: null,
    ...overrides,
})

// Helper: queue the two standard mocks (accounts, schedules).
// Categories are no longer fetched by the page — category_name is on each schedule.
function mockFetch(
    accounts = [makeAccount()],
    schedules: ReturnType<typeof makeSchedule>[] = [],
) {
    vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: accounts })
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
        // Accounts resolves; schedules never does — page stays in loading state.
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })
            .mockReturnValueOnce(new Promise<never>(() => {}))

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })

    it('shows an error message when the fetch fails', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })
            .mockRejectedValueOnce(new Error('Network error'))

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        expect(await screen.findByText(/could not load/i)).toBeInTheDocument()
    })

    it('shows an empty-state message when there are no schedules', async () => {
        mockFetch([], [])

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        expect(await screen.findByText(/no schedules/i)).toBeInTheDocument()
    })

    it('renders a list of schedules after a successful fetch', async () => {
        mockFetch(
            [makeAccount({ id: 'acc-001', name: 'Current Account' })],
            [makeSchedule({ name: 'Netflix', amount: '15.99', frequency: 'monthly', next_occurrence: '2026-05-01', active: true, category_name: 'Bills' })],
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
            [makeSchedule({ id: 'sch-001', active: true })],
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

        // Optimistic update: badge now shows "Inactive" (anchored to avoid matching "Show Inactive")
        expect(await screen.findByRole('button', { name: /^inactive$/i })).toBeInTheDocument()
    })

    it('toggles a schedule from inactive to active when the badge is clicked', async () => {
        mockFetch(
            [makeAccount()],
            [makeSchedule({ id: 'sch-001', active: false })],
        )
        vi.mocked(axios.patch).mockResolvedValueOnce({ data: {} })

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        await userEvent.click(await screen.findByRole('button', { name: /^inactive$/i }))

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
    // Show Inactive toggle
    // =========================================================================

    it('shows a Show Inactive button once loaded', async () => {
        mockFetch()

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        expect(await screen.findByRole('button', { name: /show inactive/i })).toBeInTheDocument()
    })

    it('re-fetches with include_inactive=true when Show Inactive is clicked', async () => {
        // Initial load (active only) then re-fetch after toggle
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })   // initial: accounts
            .mockResolvedValueOnce({ data: [] })   // initial: schedules
            .mockResolvedValueOnce({ data: [] })   // re-fetch: accounts
            .mockResolvedValueOnce({ data: [] })   // re-fetch: schedules

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)
        await screen.findByText(/no schedules/i)

        await userEvent.click(screen.getByRole('button', { name: /show inactive/i }))

        await waitFor(() => {
            const calls = vi.mocked(axios.get).mock.calls
            const schedCall = calls.find(
                ([url, config]) =>
                    String(url).includes('/api/v1/schedules') &&
                    (config as { params?: { include_inactive?: boolean } })?.params?.include_inactive === true
            )
            expect(schedCall).toBeDefined()
        })
    })

    it('button text toggles to Hide Inactive after clicking Show Inactive', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [] })

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)
        await screen.findByText(/no schedules/i)

        await userEvent.click(screen.getByRole('button', { name: /show inactive/i }))

        expect(await screen.findByRole('button', { name: /hide inactive/i })).toBeInTheDocument()
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
    // Edit Schedule
    // =========================================================================

    it('renders an Edit button for each schedule row', async () => {
        mockFetch(
            [makeAccount()],
            [makeSchedule({ name: 'Netflix' })],
        )

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        expect(await screen.findByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    })

    it('opens the edit form when Edit is clicked', async () => {
        mockFetch(
            [makeAccount()],
            [makeSchedule({ name: 'Netflix' })],
        )
        // Edit form's account + category fetch
        vi.mocked(axios.get).mockResolvedValue({ data: [] })

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        await userEvent.click(await screen.findByRole('button', { name: /^edit$/i }))

        // Edit form has "Edit Schedule" heading
        expect(await screen.findByText('Edit Schedule')).toBeInTheDocument()
        // "Update Schedule" submit button
        expect(screen.getByRole('button', { name: /update schedule/i })).toBeInTheDocument()
    })

    it('closes the Add form when Edit is clicked (mutual exclusion)', async () => {
        mockFetch(
            [makeAccount()],
            [makeSchedule()],
        )
        vi.mocked(axios.get).mockResolvedValue({ data: [] })

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        // Open the Add form first
        await userEvent.click(await screen.findByRole('button', { name: /add schedule/i }))
        expect(screen.getByLabelText(/^frequency$/i)).toBeInTheDocument()

        // Click Edit — Add form should disappear, Edit form appears
        await userEvent.click(screen.getByRole('button', { name: /^edit$/i }))

        expect(await screen.findByText('Edit Schedule')).toBeInTheDocument()
        // Add form's frequency select is now gone (Edit form also has frequency, but heading distinguishes)
        // The "New Schedule" heading should not be present
        expect(screen.queryByText('New Schedule')).not.toBeInTheDocument()
    })

    it('clears the edit form when Add Schedule is clicked', async () => {
        mockFetch(
            [makeAccount()],
            [makeSchedule()],
        )
        vi.mocked(axios.get).mockResolvedValue({ data: [] })

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        // Open edit form
        await userEvent.click(await screen.findByRole('button', { name: /^edit$/i }))
        expect(await screen.findByText('Edit Schedule')).toBeInTheDocument()

        // Click Add Schedule — edit form should close, add form opens
        await userEvent.click(screen.getByRole('button', { name: /add schedule/i }))

        expect(await screen.findByText('New Schedule')).toBeInTheDocument()
        expect(screen.queryByText('Edit Schedule')).not.toBeInTheDocument()
    })

    // =========================================================================
    // Integration: schedule added triggers re-fetch
    // =========================================================================

    it('re-fetches and hides the form after a schedule is added', async () => {
        // Initial load: accounts + empty schedules
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })                    // page: accounts
            .mockResolvedValueOnce({ data: [] })                    // page: schedules
        // AddScheduleForm's own account/category fetch (the form fetches both)
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
        // Post succeeds
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })
        // Re-fetch after add: accounts + one schedule now
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
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

    // =========================================================================
    // Group sections
    // =========================================================================

    it('shows group section headers when schedules span multiple groups', async () => {
        mockFetch(
            [makeAccount()],
            [
                makeSchedule({ id: 'sch-uk', name: 'UK Rent', group: 'UK' }),
                makeSchedule({ id: 'sch-es', name: 'Alquiler', group: 'España' }),
            ],
        )

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        await screen.findByText('UK Rent')

        expect(screen.getByText(/── UK ──/i)).toBeInTheDocument()
        expect(screen.getByText(/── España ──/i)).toBeInTheDocument()
    })

    it('does not show group headers when only one group exists', async () => {
        mockFetch(
            [makeAccount()],
            [makeSchedule({ group: 'UK' })],
        )

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        await screen.findByText('Netflix')

        expect(screen.queryByText(/── UK ──/i)).not.toBeInTheDocument()
    })

    it('uses "General" as the section header for schedules with no group', async () => {
        mockFetch(
            [makeAccount()],
            [
                makeSchedule({ id: 'sch-uk', name: 'UK Rent', group: 'UK' }),
                makeSchedule({ id: 'sch-none', name: 'Ungrouped', group: null }),
            ],
        )

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        await screen.findByText('UK Rent')

        expect(screen.getByText(/── General ──/i)).toBeInTheDocument()
    })

    it('sorts schedules alphabetically within each group', async () => {
        mockFetch(
            [makeAccount()],
            [
                // Deliberately not alphabetical in the mock response
                makeSchedule({ id: 'sch-1', name: 'Netflix', group: 'UK' }),
                makeSchedule({ id: 'sch-2', name: 'Amazon Prime', group: 'UK' }),
                makeSchedule({ id: 'sch-3', name: 'Spotify', group: 'UK' }),
            ],
        )

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        await screen.findByText('Netflix')

        // Find the table rows' first-cell (name) content in render order.
        const nameCells = screen
            .getAllByRole('row', { name: /click to edit/i })
            .map((row) => row.querySelector('td')?.textContent)
        expect(nameCells).toEqual(['Amazon Prime', 'Netflix', 'Spotify'])
    })

    // =========================================================================
    // Add now button
    // =========================================================================

    it('renders an "Add now" button for each regular schedule row', async () => {
        mockFetch(
            [makeAccount()],
            [makeSchedule({ name: 'Netflix' })],
        )

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        expect(await screen.findByRole('button', { name: /add transaction from netflix/i })).toBeInTheDocument()
    })

    it('disables "Add now" button for transfer-type schedules', async () => {
        mockFetch(
            [makeAccount()],
            [makeSchedule({ name: 'Monthly Transfer', schedule_type: 'transfer' })],
        )

        render(<MemoryRouter><SchedulesPage /></MemoryRouter>)

        const btn = await screen.findByRole('button', { name: /add transaction from monthly transfer/i })
        expect(btn).toBeDisabled()
    })
})
