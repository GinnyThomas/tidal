// components/AddPromotionForm.test.tsx

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import AddPromotionForm from './AddPromotionForm'
import { getApiBaseUrl } from '../lib/api'

vi.mock('axios')

describe('AddPromotionForm', () => {
    const mockOnSaved = vi.fn()

    beforeEach(() => {
        localStorage.setItem('access_token', 'fake-token')
        mockOnSaved.mockClear()
        vi.mocked(axios.get).mockResolvedValue({ data: [] })
    })

    afterEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    it('renders all form fields', () => {
        render(<MemoryRouter><AddPromotionForm onPromotionSaved={mockOnSaved} /></MemoryRouter>)

        expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/type/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/original balance/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/interest rate/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/start date/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/end date/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /save promotion/i })).toBeInTheDocument()
    })

    it('submits POST to create a promotion', async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })

        render(<MemoryRouter><AddPromotionForm onPromotionSaved={mockOnSaved} /></MemoryRouter>)

        await userEvent.type(screen.getByLabelText(/^name$/i), 'Test BNPL')
        await userEvent.type(screen.getByLabelText(/original balance/i), '500')
        await userEvent.type(screen.getByLabelText(/end date/i), '2026-12-31')
        await userEvent.click(screen.getByRole('button', { name: /save promotion/i }))

        await waitFor(() => {
            expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
                `${getApiBaseUrl()}/api/v1/promotions`,
                expect.objectContaining({ name: 'Test BNPL' }),
                expect.anything(),
            )
        })
        expect(mockOnSaved).toHaveBeenCalledTimes(1)
    })

    it('shows Edit heading and Update button in edit mode', () => {
        const editing = {
            id: 'promo-1', name: 'Test', promotion_type: 'bnpl',
            account_id: null, original_balance: '1000.00', interest_rate: '0.00',
            start_date: '2026-01-01', end_date: '2026-12-31',
            minimum_monthly_payment: null, is_active: true, notes: null,
        }
        render(<MemoryRouter><AddPromotionForm onPromotionSaved={mockOnSaved} editingPromotion={editing} /></MemoryRouter>)

        expect(screen.getByText('Edit Promotion')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /update promotion/i })).toBeInTheDocument()
    })
})
