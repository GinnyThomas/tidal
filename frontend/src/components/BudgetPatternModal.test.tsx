// components/BudgetPatternModal.test.tsx
//
// Purpose: Tests for BudgetPatternModal — the modal for managing
//          a budget's monthly override pattern.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import BudgetPatternModal from './BudgetPatternModal'

vi.mock('axios')

const makeBudget = (overrides = {}) => ({
    id: 'bud-001',
    category_id: 'cat-001',
    default_amount: '150.00',
    currency: 'GBP',
    group: 'UK',
    notes: null as string | null,
    overrides: [] as { id: string; budget_id: string; month: number; amount: string }[],
    ...overrides,
})

describe('BudgetPatternModal', () => {
    const onClose = vi.fn()
    const onSaved = vi.fn()

    beforeEach(() => {
        localStorage.setItem('access_token', 'fake-token')
        onClose.mockClear()
        onSaved.mockClear()
    })

    afterEach(() => {
        localStorage.clear()
        vi.resetAllMocks()
    })

    it('renders with default amount and category name', () => {
        render(
            <MemoryRouter>
                <BudgetPatternModal
                    budget={makeBudget()}
                    categoryName="Misc Entertainment"
                    onClose={onClose}
                    onSaved={onSaved}
                />
            </MemoryRouter>
        )

        expect(screen.getByText('Misc Entertainment')).toBeInTheDocument()
        expect(screen.getByLabelText(/default monthly amount/i)).toHaveValue(150)
        expect(screen.getByText(/UK/)).toBeInTheDocument()
        expect(screen.getByText(/GBP/)).toBeInTheDocument()
    })

    it('renders existing overrides in month inputs', () => {
        render(
            <MemoryRouter>
                <BudgetPatternModal
                    budget={makeBudget({
                        overrides: [
                            { id: 'ov-1', budget_id: 'bud-001', month: 3, amount: '200.00' },
                        ],
                    })}
                    categoryName="Test"
                    onClose={onClose}
                    onSaved={onSaved}
                />
            </MemoryRouter>
        )

        // Mar (index 2) has override value
        expect(screen.getByLabelText(/override for mar/i)).toHaveValue(200)
        // Jan (index 0) has no override — shows placeholder
        expect(screen.getByLabelText(/override for jan/i)).toHaveValue(null)
    })

    it('editing default monthly updates the input', async () => {
        render(
            <MemoryRouter>
                <BudgetPatternModal
                    budget={makeBudget()}
                    categoryName="Test"
                    onClose={onClose}
                    onSaved={onSaved}
                />
            </MemoryRouter>
        )

        const input = screen.getByLabelText(/default monthly amount/i)
        await userEvent.clear(input)
        await userEvent.type(input, '200')
        expect(input).toHaveValue(200)
    })

    it('"Apply to all" copies default to all 12 month inputs', async () => {
        render(
            <MemoryRouter>
                <BudgetPatternModal
                    budget={makeBudget()}
                    categoryName="Test"
                    onClose={onClose}
                    onSaved={onSaved}
                />
            </MemoryRouter>
        )

        await userEvent.click(screen.getByText('Apply to all'))

        // All months should have the default value
        for (const month of ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']) {
            expect(screen.getByLabelText(`Override for ${month}`)).toHaveValue(150)
        }
    })

    it('Monthly preset sets all months to the default', async () => {
        render(
            <MemoryRouter>
                <BudgetPatternModal
                    budget={makeBudget()}
                    categoryName="Test"
                    onClose={onClose}
                    onSaved={onSaved}
                />
            </MemoryRouter>
        )

        await userEvent.click(screen.getByText('Monthly'))

        expect(screen.getByLabelText(/override for jan/i)).toHaveValue(150)
        expect(screen.getByLabelText(/override for dec/i)).toHaveValue(150)
    })

    it('Quarterly preset sets Mar/Jun/Sep/Dec; others to 0', async () => {
        render(
            <MemoryRouter>
                <BudgetPatternModal
                    budget={makeBudget()}
                    categoryName="Test"
                    onClose={onClose}
                    onSaved={onSaved}
                />
            </MemoryRouter>
        )

        await userEvent.click(screen.getByText('Quarterly'))

        // Quarter months get the default
        expect(screen.getByLabelText(/override for mar/i)).toHaveValue(150)
        expect(screen.getByLabelText(/override for jun/i)).toHaveValue(150)
        expect(screen.getByLabelText(/override for sep/i)).toHaveValue(150)
        expect(screen.getByLabelText(/override for dec/i)).toHaveValue(150)
        // Non-quarter months get 0
        expect(screen.getByLabelText(/override for jan/i)).toHaveValue(0)
        expect(screen.getByLabelText(/override for feb/i)).toHaveValue(0)
    })

    it('Annual preset sets Jan to default; others to 0', async () => {
        render(
            <MemoryRouter>
                <BudgetPatternModal
                    budget={makeBudget()}
                    categoryName="Test"
                    onClose={onClose}
                    onSaved={onSaved}
                />
            </MemoryRouter>
        )

        await userEvent.click(screen.getByText('Annual'))

        expect(screen.getByLabelText(/override for jan/i)).toHaveValue(150)
        expect(screen.getByLabelText(/override for feb/i)).toHaveValue(0)
        expect(screen.getByLabelText(/override for dec/i)).toHaveValue(0)
    })

    it('"Clear all" empties all overrides', async () => {
        render(
            <MemoryRouter>
                <BudgetPatternModal
                    budget={makeBudget({
                        overrides: [
                            { id: 'ov-1', budget_id: 'bud-001', month: 1, amount: '200.00' },
                            { id: 'ov-2', budget_id: 'bud-001', month: 6, amount: '300.00' },
                        ],
                    })}
                    categoryName="Test"
                    onClose={onClose}
                    onSaved={onSaved}
                />
            </MemoryRouter>
        )

        // Verify overrides are initially set
        expect(screen.getByLabelText(/override for jan/i)).toHaveValue(200)

        await userEvent.click(screen.getByLabelText(/clear all overrides/i))

        // All months should be empty (null = placeholder)
        expect(screen.getByLabelText(/override for jan/i)).toHaveValue(null)
        expect(screen.getByLabelText(/override for jun/i)).toHaveValue(null)
    })

    it('"reset" link on a month clears that single override', async () => {
        render(
            <MemoryRouter>
                <BudgetPatternModal
                    budget={makeBudget({
                        overrides: [
                            { id: 'ov-1', budget_id: 'bud-001', month: 3, amount: '200.00' },
                        ],
                    })}
                    categoryName="Test"
                    onClose={onClose}
                    onSaved={onSaved}
                />
            </MemoryRouter>
        )

        // Mar has a reset link because it has an override
        const resetButtons = screen.getAllByText('reset')
        expect(resetButtons.length).toBeGreaterThanOrEqual(1)

        await userEvent.click(resetButtons[0])

        // Mar should now be empty (placeholder shows default)
        expect(screen.getByLabelText(/override for mar/i)).toHaveValue(null)
    })

    it('Save calls correct endpoints with the right payload', async () => {
        vi.mocked(axios.put).mockResolvedValueOnce({ data: {} })
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })

        render(
            <MemoryRouter>
                <BudgetPatternModal
                    budget={makeBudget({ notes: 'old note' })}
                    categoryName="Test"
                    onClose={onClose}
                    onSaved={onSaved}
                />
            </MemoryRouter>
        )

        // Change default amount
        const input = screen.getByLabelText(/default monthly amount/i)
        await userEvent.clear(input)
        await userEvent.type(input, '200')

        // Change notes
        const notesInput = screen.getByLabelText(/budget notes/i)
        await userEvent.clear(notesInput)
        await userEvent.type(notesInput, 'new note')

        await userEvent.click(screen.getByText('Save'))

        await waitFor(() => {
            // PUT to update budget
            expect(vi.mocked(axios.put)).toHaveBeenCalledWith(
                expect.stringContaining('/api/v1/budgets/bud-001'),
                expect.objectContaining({
                    default_amount: '200',
                    notes: 'new note',
                }),
                expect.anything()
            )

            // POST to batch overrides
            expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
                expect.stringContaining('/overrides/batch'),
                expect.objectContaining({
                    overrides: expect.arrayContaining([
                        expect.objectContaining({ month: 1 }),
                    ]),
                }),
                expect.anything()
            )
        })

        expect(onSaved).toHaveBeenCalled()
    })

    it('Save is disabled when nothing has changed', () => {
        render(
            <MemoryRouter>
                <BudgetPatternModal
                    budget={makeBudget()}
                    categoryName="Test"
                    onClose={onClose}
                    onSaved={onSaved}
                />
            </MemoryRouter>
        )

        expect(screen.getByText('Save')).toBeDisabled()
    })

    it('Cancel closes without saving', async () => {
        render(
            <MemoryRouter>
                <BudgetPatternModal
                    budget={makeBudget()}
                    categoryName="Test"
                    onClose={onClose}
                    onSaved={onSaved}
                />
            </MemoryRouter>
        )

        await userEvent.click(screen.getByText('Cancel'))

        expect(onClose).toHaveBeenCalled()
        expect(vi.mocked(axios.put)).not.toHaveBeenCalled()
        expect(vi.mocked(axios.post)).not.toHaveBeenCalled()
    })

    it('closes on successful save and parent refreshes', async () => {
        vi.mocked(axios.put).mockResolvedValueOnce({ data: {} })
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })

        render(
            <MemoryRouter>
                <BudgetPatternModal
                    budget={makeBudget()}
                    categoryName="Test"
                    onClose={onClose}
                    onSaved={onSaved}
                />
            </MemoryRouter>
        )

        // Make a change so Save is enabled
        await userEvent.click(screen.getByText('Apply to all'))
        await userEvent.click(screen.getByText('Save'))

        await waitFor(() => {
            expect(onSaved).toHaveBeenCalledTimes(1)
        })
        // onClose is NOT called — onSaved handler in the parent closes the modal
    })

    it('shows error when save fails and does not close', async () => {
        vi.mocked(axios.post).mockRejectedValueOnce(new Error('fail'))

        render(
            <MemoryRouter>
                <BudgetPatternModal
                    budget={makeBudget()}
                    categoryName="Test"
                    onClose={onClose}
                    onSaved={onSaved}
                />
            </MemoryRouter>
        )

        // Make a change
        await userEvent.click(screen.getByText('Apply to all'))
        await userEvent.click(screen.getByText('Save'))

        expect(await screen.findByText(/could not save/i)).toBeInTheDocument()
        expect(onSaved).not.toHaveBeenCalled()
    })
})
