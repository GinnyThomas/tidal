// pages/PromotionsPage.test.tsx

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import PromotionsPage from './PromotionsPage'

vi.mock('axios')

const makePromotion = (overrides = {}) => ({
    id: 'promo-001',
    user_id: 'user-001',
    account_id: null,
    name: 'MBNA Balance Transfer',
    promotion_type: 'balance_transfer',
    original_balance: '2000.00',
    interest_rate: '0.00',
    start_date: '2026-01-01',
    end_date: '2026-10-01',
    minimum_monthly_payment: '50.00',
    is_active: true,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    days_remaining: 90,
    required_monthly_payment: '500.00',
    total_paid: '500.00',
    remaining_balance: '1500.00',
    urgency: 'ok',
    ...overrides,
})

describe('PromotionsPage', () => {
    beforeEach(() => {
        localStorage.setItem('access_token', 'fake-token')
    })

    afterEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    it('shows a loading indicator while the fetch is in progress', () => {
        vi.mocked(axios.get).mockReturnValueOnce(new Promise<never>(() => {}))
        render(<MemoryRouter><PromotionsPage /></MemoryRouter>)
        expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })

    it('shows empty state when no promotions exist', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [] })
        render(<MemoryRouter><PromotionsPage /></MemoryRouter>)
        expect(await screen.findByText(/no promotions found/i)).toBeInTheDocument()
    })

    it('renders promotion cards with key figures', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [makePromotion()] })
        render(<MemoryRouter><PromotionsPage /></MemoryRouter>)

        expect(await screen.findByText('MBNA Balance Transfer')).toBeInTheDocument()
        expect(screen.getByText('2000.00')).toBeInTheDocument()
        expect(screen.getByText('500.00')).toBeInTheDocument()
        expect(screen.getByText('1500.00')).toBeInTheDocument()
        expect(screen.getByText(/OK/)).toBeInTheDocument()
    })

    it('shows urgency badges correctly', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: [makePromotion({ urgency: 'critical', days_remaining: 3 })],
        })
        render(<MemoryRouter><PromotionsPage /></MemoryRouter>)

        expect(await screen.findByText(/CRITICAL/)).toBeInTheDocument()
    })

    it('shows AddPromotionForm when Add Promotion is clicked', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [] })
        vi.mocked(axios.get).mockResolvedValue({ data: [] })
        render(<MemoryRouter><PromotionsPage /></MemoryRouter>)

        await screen.findByText(/no promotions/i)
        await userEvent.click(screen.getByRole('button', { name: /add promotion/i }))
        expect(screen.getByText('New Promotion')).toBeInTheDocument()
    })

    it('clicking a promotion card opens edit form', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [makePromotion()] })
        vi.mocked(axios.get).mockResolvedValue({ data: [] })
        render(<MemoryRouter><PromotionsPage /></MemoryRouter>)

        await screen.findByText('MBNA Balance Transfer')
        await userEvent.click(screen.getByText('MBNA Balance Transfer'))
        expect(screen.getByText('Edit Promotion')).toBeInTheDocument()
    })
})
