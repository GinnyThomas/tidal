// components/AddReallocationForm.test.tsx

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import AddReallocationForm from './AddReallocationForm'
import { getApiBaseUrl } from '../lib/api'

vi.mock('axios')

const makeCategory = (overrides = {}) => ({
    id: 'cat-001',
    name: 'Groceries UK',
    parent_category_id: null,
    ...overrides,
})

describe('AddReallocationForm', () => {
    const defaultProps = {
        fromCategoryId: 'cat-from',
        fromCategoryName: 'Food & Drink',
        year: 2026,
        month: 4,
        maxAmount: '200.00',
        onReallocationAdded: vi.fn(),
        onCancel: vi.fn(),
    }

    beforeEach(() => {
        localStorage.setItem('access_token', 'fake-token')
        defaultProps.onReallocationAdded.mockClear()
        defaultProps.onCancel.mockClear()
        // Categories fetch — exclude the from category
        vi.mocked(axios.get).mockResolvedValue({
            data: [
                makeCategory({ id: 'cat-from', name: 'Food & Drink' }),
                makeCategory({ id: 'cat-to', name: 'Travel' }),
            ],
        })
    })

    afterEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    it('renders with the from category pre-populated as read-only', async () => {
        render(<MemoryRouter><AddReallocationForm {...defaultProps} /></MemoryRouter>)

        // From category shown as text, not editable
        expect(screen.getByText('Food & Drink')).toBeInTheDocument()
        // To dropdown should have Travel (from category excluded)
        expect(await screen.findByRole('option', { name: 'Travel' })).toBeInTheDocument()
        // Amount and reason fields present
        expect(screen.getByLabelText(/amount/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/reason/i)).toBeInTheDocument()
    })

    it('submits POST with correct payload', async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })

        render(<MemoryRouter><AddReallocationForm {...defaultProps} /></MemoryRouter>)

        await screen.findByRole('option', { name: 'Travel' })
        await userEvent.type(screen.getByLabelText(/amount/i), '50')
        await userEvent.type(screen.getByLabelText(/reason/i), 'Holiday fund')
        await userEvent.click(screen.getByRole('button', { name: /^reallocate$/i }))

        await waitFor(() => {
            expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
                `${getApiBaseUrl()}/api/v1/reallocations`,
                expect.objectContaining({
                    from_category_id: 'cat-from',
                    to_category_id: 'cat-to',
                    amount: '50',
                    reason: 'Holiday fund',
                    year: 2026,
                    month: 4,
                }),
                expect.anything(),
            )
        })

        expect(defaultProps.onReallocationAdded).toHaveBeenCalledTimes(1)
    })

    it('shows error message on failure', async () => {
        vi.mocked(axios.post).mockRejectedValueOnce(new Error('fail'))

        render(<MemoryRouter><AddReallocationForm {...defaultProps} /></MemoryRouter>)

        await screen.findByRole('option', { name: 'Travel' })
        await userEvent.type(screen.getByLabelText(/amount/i), '50')
        await userEvent.type(screen.getByLabelText(/reason/i), 'test')
        await userEvent.click(screen.getByRole('button', { name: /^reallocate$/i }))

        expect(await screen.findByText(/could not create reallocation/i)).toBeInTheDocument()
    })

    it('calls onCancel when Cancel is clicked', async () => {
        render(<MemoryRouter><AddReallocationForm {...defaultProps} /></MemoryRouter>)

        await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

        expect(defaultProps.onCancel).toHaveBeenCalledTimes(1)
    })
})
