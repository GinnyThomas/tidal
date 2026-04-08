// components/AddScheduleForm.test.tsx
//
// Purpose: Tests for AddScheduleForm — the recurring schedule creation form.
//
// Test strategy:
//   Verify: all fields render with correct defaults, conditional fields
//   (interval shown for weekly/every_n_days; day_of_month shown for
//   monthly/quarterly/annually), dropdowns populated from API, form
//   submits correctly, callback fires on success, error shown on failure.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import AddScheduleForm from './AddScheduleForm'
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

describe('AddScheduleForm', () => {
    const mockOnScheduleAdded = vi.fn()

    beforeEach(() => {
        localStorage.setItem('access_token', 'fake-token')
        mockOnScheduleAdded.mockClear()
        vi.mocked(axios.get).mockResolvedValue({ data: [] })
    })

    afterEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    // =========================================================================
    // Rendering
    // =========================================================================

    it('renders all form fields with correct defaults', () => {
        render(<MemoryRouter><AddScheduleForm onScheduleAdded={mockOnScheduleAdded} /></MemoryRouter>)

        expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/^account$/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/^category$/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/^amount$/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/^currency$/i)).toHaveValue('GBP')
        expect(screen.getByLabelText(/^frequency$/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/start date/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/end date/i)).toBeInTheDocument()
        // auto-generate checkbox is checked by default
        expect(screen.getByLabelText(/auto.generate/i)).toBeChecked()
        expect(screen.getByLabelText(/payee/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/note/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /save schedule/i })).toBeInTheDocument()
    })

    it('shows interval field only for weekly and every_n_days frequencies', async () => {
        render(<MemoryRouter><AddScheduleForm onScheduleAdded={mockOnScheduleAdded} /></MemoryRouter>)

        // Default is monthly — interval should NOT be visible
        expect(screen.queryByLabelText(/^interval$/i)).not.toBeInTheDocument()

        // Switch to weekly — interval appears
        await userEvent.selectOptions(screen.getByLabelText(/^frequency$/i), 'weekly')
        expect(screen.getByLabelText(/^interval$/i)).toBeInTheDocument()

        // Switch back to monthly — interval hidden again
        await userEvent.selectOptions(screen.getByLabelText(/^frequency$/i), 'monthly')
        expect(screen.queryByLabelText(/^interval$/i)).not.toBeInTheDocument()

        // every_n_days — interval appears
        await userEvent.selectOptions(screen.getByLabelText(/^frequency$/i), 'every_n_days')
        expect(screen.getByLabelText(/^interval$/i)).toBeInTheDocument()
    })

    it('shows day_of_month field only for monthly, quarterly, and annually frequencies', async () => {
        render(<MemoryRouter><AddScheduleForm onScheduleAdded={mockOnScheduleAdded} /></MemoryRouter>)

        // Default is monthly — day_of_month IS visible
        expect(screen.getByLabelText(/day of month/i)).toBeInTheDocument()

        // Switch to weekly — day_of_month hidden
        await userEvent.selectOptions(screen.getByLabelText(/^frequency$/i), 'weekly')
        expect(screen.queryByLabelText(/day of month/i)).not.toBeInTheDocument()

        // daily — day_of_month hidden
        await userEvent.selectOptions(screen.getByLabelText(/^frequency$/i), 'daily')
        expect(screen.queryByLabelText(/day of month/i)).not.toBeInTheDocument()

        // quarterly — day_of_month visible
        await userEvent.selectOptions(screen.getByLabelText(/^frequency$/i), 'quarterly')
        expect(screen.getByLabelText(/day of month/i)).toBeInTheDocument()

        // annually — day_of_month visible
        await userEvent.selectOptions(screen.getByLabelText(/^frequency$/i), 'annually')
        expect(screen.getByLabelText(/day of month/i)).toBeInTheDocument()
    })

    it('populates account and category dropdowns from the API', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount({ name: 'Nationwide' })] })
            .mockResolvedValueOnce({ data: [makeCategory({ name: 'Groceries' })] })

        render(<MemoryRouter><AddScheduleForm onScheduleAdded={mockOnScheduleAdded} /></MemoryRouter>)

        expect(await screen.findByRole('option', { name: 'Nationwide' })).toBeInTheDocument()
        expect(await screen.findByRole('option', { name: 'Groceries' })).toBeInTheDocument()
    })

    // =========================================================================
    // Submission
    // =========================================================================

    it('submits to POST /api/v1/schedules with the Authorization header', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount({ id: 'acc-001' })] })
            .mockResolvedValueOnce({ data: [makeCategory({ id: 'cat-001' })] })
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })

        render(<MemoryRouter><AddScheduleForm onScheduleAdded={mockOnScheduleAdded} /></MemoryRouter>)

        await screen.findByRole('option', { name: 'Current Account' })
        await userEvent.type(screen.getByLabelText(/^name$/i), 'Netflix')
        await userEvent.type(screen.getByLabelText(/^amount$/i), '15.99')
        await userEvent.click(screen.getByRole('button', { name: /save schedule/i }))

        await waitFor(() => {
            expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
                `${getApiBaseUrl()}/api/v1/schedules`,
                expect.objectContaining({
                    name: 'Netflix',
                    account_id: 'acc-001',
                    category_id: 'cat-001',
                    amount: '15.99',
                    currency: 'GBP',
                    frequency: 'monthly',
                }),
                expect.objectContaining({
                    headers: { Authorization: 'Bearer fake-token' },
                })
            )
        })
    })

    it('calls onScheduleAdded after a successful submission', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })

        render(<MemoryRouter><AddScheduleForm onScheduleAdded={mockOnScheduleAdded} /></MemoryRouter>)

        await screen.findByRole('option', { name: 'Current Account' })
        await userEvent.type(screen.getByLabelText(/^name$/i), 'Rent')
        await userEvent.type(screen.getByLabelText(/^amount$/i), '900')
        await userEvent.click(screen.getByRole('button', { name: /save schedule/i }))

        await waitFor(() => expect(mockOnScheduleAdded).toHaveBeenCalledTimes(1))
    })

    it('shows an error message when submission fails', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount()] })
            .mockResolvedValueOnce({ data: [makeCategory()] })
        vi.mocked(axios.post).mockRejectedValueOnce(new Error('Server error'))

        render(<MemoryRouter><AddScheduleForm onScheduleAdded={mockOnScheduleAdded} /></MemoryRouter>)

        await screen.findByRole('option', { name: 'Current Account' })
        await userEvent.type(screen.getByLabelText(/^name$/i), 'Rent')
        await userEvent.type(screen.getByLabelText(/^amount$/i), '900')
        await userEvent.click(screen.getByRole('button', { name: /save schedule/i }))

        expect(await screen.findByText(/could not create schedule/i)).toBeInTheDocument()
        expect(mockOnScheduleAdded).not.toHaveBeenCalled()
    })
})
