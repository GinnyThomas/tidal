// components/AddBudgetForm.test.tsx
//
// Purpose: Tests for AddBudgetForm — the budget create/edit form.
//
// Test strategy:
//   Rendering with correct defaults, category dropdown populated from API,
//   correct POST on create, correct PUT on edit, error handling.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import AddBudgetForm from './AddBudgetForm'
import { getApiBaseUrl } from '../lib/api'

vi.mock('axios')

const makeCategory = (overrides = {}) => ({
    id: 'cat-001',
    name: 'Groceries UK',
    parent_category_id: null,
    ...overrides,
})

describe('AddBudgetForm', () => {
    const mockOnSaved = vi.fn()

    beforeEach(() => {
        localStorage.setItem('access_token', 'fake-token')
        mockOnSaved.mockClear()
        vi.mocked(axios.get).mockResolvedValue({ data: [makeCategory()] })
    })

    afterEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    it('renders all form fields with correct defaults', async () => {
        render(<MemoryRouter><AddBudgetForm onBudgetSaved={mockOnSaved} /></MemoryRouter>)

        // Wait for category dropdown to populate
        await screen.findByRole('option', { name: 'Groceries UK' })

        expect(screen.getByLabelText(/category/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/year/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/default monthly amount/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/^currency$/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/group/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /save budget/i })).toBeInTheDocument()
    })

    it('submits POST to create a new budget', async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })

        render(<MemoryRouter><AddBudgetForm onBudgetSaved={mockOnSaved} defaultYear={2026} /></MemoryRouter>)

        await screen.findByRole('option', { name: 'Groceries UK' })
        await userEvent.type(screen.getByLabelText(/default monthly amount/i), '300')
        await userEvent.click(screen.getByRole('button', { name: /save budget/i }))

        await waitFor(() => {
            expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
                `${getApiBaseUrl()}/api/v1/budgets`,
                expect.objectContaining({
                    category_id: 'cat-001',
                    year: 2026,
                    currency: 'GBP',
                }),
                expect.objectContaining({
                    headers: { Authorization: 'Bearer fake-token' },
                })
            )
        })

        expect(mockOnSaved).toHaveBeenCalledTimes(1)
    })

    it('shows Edit Budget heading and Update button in edit mode', async () => {
        const editingBudget = {
            id: 'bud-001',
            category_id: 'cat-001',
            year: 2026,
            default_amount: '300.00',
            currency: 'GBP',
            group: 'UK',
        }

        render(
            <MemoryRouter>
                <AddBudgetForm onBudgetSaved={mockOnSaved} editingBudget={editingBudget} />
            </MemoryRouter>
        )

        expect(screen.getByText('Edit Budget')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /update budget/i })).toBeInTheDocument()
        // In edit mode, category and year selectors are hidden
        expect(screen.queryByLabelText(/category/i)).not.toBeInTheDocument()
        expect(screen.queryByLabelText(/year/i)).not.toBeInTheDocument()
    })

    it('submits PUT in edit mode', async () => {
        vi.mocked(axios.put).mockResolvedValueOnce({ data: {} })

        const editingBudget = {
            id: 'bud-001',
            category_id: 'cat-001',
            year: 2026,
            default_amount: '300.00',
            currency: 'GBP',
            group: 'UK',
        }

        render(
            <MemoryRouter>
                <AddBudgetForm onBudgetSaved={mockOnSaved} editingBudget={editingBudget} />
            </MemoryRouter>
        )

        await userEvent.click(screen.getByRole('button', { name: /update budget/i }))

        await waitFor(() => {
            expect(vi.mocked(axios.put)).toHaveBeenCalledWith(
                `${getApiBaseUrl()}/api/v1/budgets/bud-001`,
                expect.objectContaining({
                    default_amount: '300.00',
                    currency: 'GBP',
                }),
                expect.objectContaining({
                    headers: { Authorization: 'Bearer fake-token' },
                })
            )
        })

        expect(mockOnSaved).toHaveBeenCalledTimes(1)
    })

    it('shows error message when submission fails', async () => {
        vi.mocked(axios.post).mockRejectedValueOnce(new Error('Server error'))

        render(<MemoryRouter><AddBudgetForm onBudgetSaved={mockOnSaved} /></MemoryRouter>)

        await screen.findByRole('option', { name: 'Groceries UK' })
        await userEvent.type(screen.getByLabelText(/default monthly amount/i), '100')
        await userEvent.click(screen.getByRole('button', { name: /save budget/i }))

        expect(await screen.findByText(/could not create budget/i)).toBeInTheDocument()
        expect(mockOnSaved).not.toHaveBeenCalled()
    })
})
