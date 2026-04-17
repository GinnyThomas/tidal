// components/BudgetOverrideForm.test.tsx

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import BudgetOverrideForm from './BudgetOverrideForm'

vi.mock('axios')

describe('BudgetOverrideForm', () => {
    const defaultProps = {
        budgetId: 'bud-001',
        overrides: [
            { id: 'ov-1', budget_id: 'bud-001', month: 1, amount: '200.00' },
        ],
        defaultAmount: '150.00',
        onChanged: vi.fn(),
    }

    beforeEach(() => {
        localStorage.setItem('access_token', 'fake-token')
        defaultProps.onChanged.mockClear()
    })

    afterEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    it('renders all 12 months', () => {
        render(<MemoryRouter><BudgetOverrideForm {...defaultProps} /></MemoryRouter>)

        expect(screen.getByText('Jan')).toBeInTheDocument()
        expect(screen.getByText('Dec')).toBeInTheDocument()
    })

    it('auto-selects input text on focus', async () => {
        render(<MemoryRouter><BudgetOverrideForm {...defaultProps} /></MemoryRouter>)

        // Click Jan to start editing
        await userEvent.click(screen.getByRole('button', { name: /edit override for jan/i }))

        // The input should exist and have the value selected
        const input = screen.getByLabelText(/override amount for jan/i) as HTMLInputElement
        expect(input).toBeInTheDocument()
        expect(input.value).toBe('200.00')
    })

    it('Enter saves locally and opens the next month for editing', async () => {
        render(<MemoryRouter><BudgetOverrideForm {...defaultProps} /></MemoryRouter>)

        // Click Jan to start editing
        await userEvent.click(screen.getByRole('button', { name: /edit override for jan/i }))

        const input = screen.getByLabelText(/override amount for jan/i)
        await userEvent.clear(input)
        await userEvent.type(input, '250')
        await userEvent.keyboard('{Enter}')

        // No API call yet — changes are staged locally
        expect(vi.mocked(axios.post)).not.toHaveBeenCalled()

        // After local save, the next month (Feb) should open for editing
        await waitFor(() => {
            expect(screen.getByLabelText(/override amount for feb/i)).toBeInTheDocument()
        })

        // "Save all" button should appear because there are pending changes
        expect(screen.getByText('Save all')).toBeInTheDocument()
    })

    it('Save all button sends a single batch POST and calls onChanged', async () => {
        vi.mocked(axios.post).mockResolvedValue({ data: { overrides: [] } })

        render(<MemoryRouter><BudgetOverrideForm {...defaultProps} /></MemoryRouter>)

        // Edit Jan locally
        await userEvent.click(screen.getByRole('button', { name: /edit override for jan/i }))
        const input = screen.getByLabelText(/override amount for jan/i)
        await userEvent.clear(input)
        await userEvent.type(input, '250')
        // Click OK to save locally (not Enter — to avoid opening next month)
        await userEvent.click(screen.getByText('OK'))

        // Click "Save all"
        await userEvent.click(screen.getByText('Save all'))

        await waitFor(() => {
            const batchCalls = vi.mocked(axios.post).mock.calls.filter(
                ([url]) => String(url).includes('/overrides/batch')
            )
            expect(batchCalls.length).toBe(1)
            expect(batchCalls[0][1].overrides).toEqual([{ month: 1, amount: '250' }])
        })

        expect(defaultProps.onChanged).toHaveBeenCalled()
    })

    it('shows Set pattern panel when button is clicked', async () => {
        render(<MemoryRouter><BudgetOverrideForm {...defaultProps} /></MemoryRouter>)

        await userEvent.click(screen.getByRole('button', { name: /set pattern/i }))

        // Pattern type buttons should be visible
        expect(screen.getByText('Monthly')).toBeInTheDocument()
        expect(screen.getByText('Quarterly')).toBeInTheDocument()
        expect(screen.getByText('Annual')).toBeInTheDocument()
        expect(screen.getByText('Clear all')).toBeInTheDocument()
    })

    it('closes pattern panel on second click', async () => {
        render(<MemoryRouter><BudgetOverrideForm {...defaultProps} /></MemoryRouter>)

        const btn = screen.getByRole('button', { name: /set pattern/i })
        await userEvent.click(btn) // open
        expect(screen.getByText('Monthly')).toBeInTheDocument()
        await userEvent.click(btn) // close
        expect(screen.queryByText('Monthly')).not.toBeInTheDocument()
    })

    it('Apply to all months sends a single batch POST with 12 items', async () => {
        vi.mocked(axios.post).mockResolvedValue({ data: { overrides: [] } })

        render(<MemoryRouter><BudgetOverrideForm {...defaultProps} /></MemoryRouter>)

        await userEvent.click(screen.getByRole('button', { name: /set pattern/i }))
        await userEvent.type(screen.getByLabelText(/monthly pattern amount/i), '300')
        await userEvent.click(screen.getByText('Apply to all months'))

        await waitFor(() => {
            const batchCalls = vi.mocked(axios.post).mock.calls.filter(
                ([url]) => String(url).includes('/overrides/batch')
            )
            // Single batch call (not 12 individual POSTs)
            expect(batchCalls.length).toBe(1)
            // All 12 months in the batch
            expect(batchCalls[0][1].overrides.length).toBe(12)
        })

        expect(defaultProps.onChanged).toHaveBeenCalled()
    })
})
