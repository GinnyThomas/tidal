// components/AddCategoryForm.test.tsx
//
// Purpose: Tests for AddCategoryForm — the category creation form.
//
// Test coverage:
//   - All fields render correctly
//   - Parent dropdown shows only the top-level categories passed as a prop
//   - Submits to the correct endpoint with Authorization header
//   - Sends null for parent_category_id when no parent is selected
//   - Calls onCategoryAdded on success
//   - Shows an error message on failure

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import AddCategoryForm from './AddCategoryForm'

vi.mock('axios')

const mockParents = [
    { id: 'cat-1', name: 'Food & Drink' },
    { id: 'cat-2', name: 'Transport' },
]

describe('AddCategoryForm', () => {
    const mockOnCategoryAdded = vi.fn()

    beforeEach(() => {
        localStorage.setItem('access_token', 'fake-token')
        mockOnCategoryAdded.mockClear()
    })

    afterEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    // =========================================================================
    // Rendering
    // =========================================================================

    it('renders all form fields', () => {
        render(
            <MemoryRouter>
                <AddCategoryForm topLevelCategories={mockParents} onCategoryAdded={mockOnCategoryAdded} />
            </MemoryRouter>
        )

        expect(screen.getByLabelText(/category name/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/parent category/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/colour/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/icon/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /save category/i })).toBeInTheDocument()
    })

    it('shows only the top-level categories passed as props in the parent dropdown', () => {
        render(
            <MemoryRouter>
                <AddCategoryForm topLevelCategories={mockParents} onCategoryAdded={mockOnCategoryAdded} />
            </MemoryRouter>
        )

        const select = screen.getByLabelText(/parent category/i) as HTMLSelectElement
        const optionTexts = Array.from(select.options).map(o => o.text)

        expect(optionTexts).toContain('Food & Drink')
        expect(optionTexts).toContain('Transport')
    })

    it('has a "None" default option so the user can create a top-level category', () => {
        render(
            <MemoryRouter>
                <AddCategoryForm topLevelCategories={mockParents} onCategoryAdded={mockOnCategoryAdded} />
            </MemoryRouter>
        )

        const select = screen.getByLabelText(/parent category/i) as HTMLSelectElement
        // Default selection should be the empty/none option
        expect(select.value).toBe('')
    })

    // =========================================================================
    // Submission
    // =========================================================================

    it('submits to the correct endpoint with the Authorization header', async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })

        render(
            <MemoryRouter>
                <AddCategoryForm topLevelCategories={mockParents} onCategoryAdded={mockOnCategoryAdded} />
            </MemoryRouter>
        )

        await userEvent.type(screen.getByLabelText(/category name/i), 'Side Hustle')
        await userEvent.click(screen.getByRole('button', { name: /save category/i }))

        await waitFor(() => {
            expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
                `${import.meta.env.VITE_API_URL}/api/v1/categories`,
                expect.objectContaining({
                    name: 'Side Hustle',
                    parent_category_id: null,
                }),
                expect.objectContaining({
                    headers: { Authorization: 'Bearer fake-token' },
                })
            )
        })
    })

    it('sends the selected parent_category_id when a parent is chosen', async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })

        render(
            <MemoryRouter>
                <AddCategoryForm topLevelCategories={mockParents} onCategoryAdded={mockOnCategoryAdded} />
            </MemoryRouter>
        )

        await userEvent.type(screen.getByLabelText(/category name/i), 'Groceries')
        await userEvent.selectOptions(screen.getByLabelText(/parent category/i), 'cat-1')
        await userEvent.click(screen.getByRole('button', { name: /save category/i }))

        await waitFor(() => {
            expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
                `${import.meta.env.VITE_API_URL}/api/v1/categories`,
                expect.objectContaining({ parent_category_id: 'cat-1' }),
                expect.anything()
            )
        })
    })

    it('calls onCategoryAdded after a successful submission', async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })

        render(
            <MemoryRouter>
                <AddCategoryForm topLevelCategories={[]} onCategoryAdded={mockOnCategoryAdded} />
            </MemoryRouter>
        )

        await userEvent.type(screen.getByLabelText(/category name/i), 'Test')
        await userEvent.click(screen.getByRole('button', { name: /save category/i }))

        await waitFor(() => expect(mockOnCategoryAdded).toHaveBeenCalledTimes(1))
    })

    it('shows an error message when the submission fails', async () => {
        vi.mocked(axios.post).mockRejectedValueOnce(new Error('Server error'))

        render(
            <MemoryRouter>
                <AddCategoryForm topLevelCategories={[]} onCategoryAdded={mockOnCategoryAdded} />
            </MemoryRouter>
        )

        await userEvent.type(screen.getByLabelText(/category name/i), 'Bad Category')
        await userEvent.click(screen.getByRole('button', { name: /save category/i }))

        expect(await screen.findByText(/could not create category/i)).toBeInTheDocument()
        expect(mockOnCategoryAdded).not.toHaveBeenCalled()
    })
})
