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
import { getApiBaseUrl } from '../lib/api'

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
                `${getApiBaseUrl()}/api/v1/categories`,
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
                `${getApiBaseUrl()}/api/v1/categories`,
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

    // =========================================================================
    // Group selector
    // =========================================================================

    it('renders group selector with None option', () => {
        render(
            <MemoryRouter>
                <AddCategoryForm topLevelCategories={mockParents} onCategoryAdded={mockOnCategoryAdded} />
            </MemoryRouter>
        )

        const select = screen.getByLabelText(/group/i) as HTMLSelectElement
        expect(select).toBeInTheDocument()
        const options = Array.from(select.options).map(o => o.text)
        expect(options).toContain('None')
        expect(options).toContain('UK')
        expect(options).toContain('España')
    })

    it('includes selected group in POST payload', async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })

        render(
            <MemoryRouter>
                <AddCategoryForm topLevelCategories={mockParents} onCategoryAdded={mockOnCategoryAdded} />
            </MemoryRouter>
        )

        await userEvent.type(screen.getByLabelText(/category name/i), 'UK Bills')
        await userEvent.selectOptions(screen.getByLabelText(/group/i), 'UK')
        await userEvent.click(screen.getByRole('button', { name: /save category/i }))

        await waitFor(() => {
            expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
                `${getApiBaseUrl()}/api/v1/categories`,
                expect.objectContaining({ group: 'UK' }),
                expect.anything()
            )
        })
    })

    it('sends null when None is selected for group', async () => {
        vi.mocked(axios.post).mockResolvedValueOnce({ data: {} })

        render(
            <MemoryRouter>
                <AddCategoryForm topLevelCategories={mockParents} onCategoryAdded={mockOnCategoryAdded} />
            </MemoryRouter>
        )

        await userEvent.type(screen.getByLabelText(/category name/i), 'General Cat')
        // Group defaults to None (empty string → null in payload)
        await userEvent.click(screen.getByRole('button', { name: /save category/i }))

        await waitFor(() => {
            expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
                `${getApiBaseUrl()}/api/v1/categories`,
                expect.objectContaining({ group: null }),
                expect.anything()
            )
        })
    })

    // =========================================================================
    // Error handling
    // =========================================================================

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

// =============================================================================
// Edit mode (editingCategory prop provided)
// =============================================================================

describe('AddCategoryForm — edit mode', () => {
    const mockOnCategoryUpdated = vi.fn()

    const editingCategory = {
        id: 'cat-1',
        name: 'Food & Drink',
        parent_category_id: null,
        colour: '#ff6600',
        icon: '🍔',
    }

    beforeEach(() => {
        localStorage.setItem('access_token', 'fake-token')
        mockOnCategoryUpdated.mockClear()
    })

    afterEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    it('pre-populates the name and colour fields from the editing category', () => {
        render(
            <MemoryRouter>
                <AddCategoryForm
                    topLevelCategories={mockParents}
                    onCategoryAdded={vi.fn()}
                    editingCategory={editingCategory}
                    onCategoryUpdated={mockOnCategoryUpdated}
                />
            </MemoryRouter>
        )

        expect(screen.getByLabelText(/category name/i)).toHaveValue('Food & Drink')
        expect(screen.getByLabelText(/colour/i)).toHaveValue('#ff6600')
        // The matching emoji button should be aria-pressed=true
        expect(screen.getByRole('button', { pressed: true, name: '🍔' })).toBeInTheDocument()
    })

    it('shows "Update Category" as the submit button text', () => {
        render(
            <MemoryRouter>
                <AddCategoryForm
                    topLevelCategories={[]}
                    onCategoryAdded={vi.fn()}
                    editingCategory={editingCategory}
                    onCategoryUpdated={mockOnCategoryUpdated}
                />
            </MemoryRouter>
        )

        expect(screen.getByRole('button', { name: /update category/i })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /save category/i })).not.toBeInTheDocument()
    })

    it('submits PUT /api/v1/categories/{id} with the Authorization header', async () => {
        vi.mocked(axios.put).mockResolvedValueOnce({ data: {} })

        render(
            <MemoryRouter>
                <AddCategoryForm
                    topLevelCategories={mockParents}
                    onCategoryAdded={vi.fn()}
                    editingCategory={editingCategory}
                    onCategoryUpdated={mockOnCategoryUpdated}
                />
            </MemoryRouter>
        )

        await userEvent.click(screen.getByRole('button', { name: /update category/i }))

        await waitFor(() => {
            expect(vi.mocked(axios.put)).toHaveBeenCalledWith(
                `${getApiBaseUrl()}/api/v1/categories/cat-1`,
                expect.objectContaining({
                    name: 'Food & Drink',
                    colour: '#ff6600',
                    icon: '🍔',
                }),
                expect.objectContaining({
                    headers: { Authorization: 'Bearer fake-token' },
                })
            )
        })
    })

    it('calls onCategoryUpdated after a successful update', async () => {
        vi.mocked(axios.put).mockResolvedValueOnce({ data: {} })

        render(
            <MemoryRouter>
                <AddCategoryForm
                    topLevelCategories={[]}
                    onCategoryAdded={vi.fn()}
                    editingCategory={editingCategory}
                    onCategoryUpdated={mockOnCategoryUpdated}
                />
            </MemoryRouter>
        )

        await userEvent.click(screen.getByRole('button', { name: /update category/i }))

        await waitFor(() => expect(mockOnCategoryUpdated).toHaveBeenCalledTimes(1))
    })

    it('shows an error message when the update fails', async () => {
        vi.mocked(axios.put).mockRejectedValueOnce(new Error('Server error'))

        render(
            <MemoryRouter>
                <AddCategoryForm
                    topLevelCategories={[]}
                    onCategoryAdded={vi.fn()}
                    editingCategory={editingCategory}
                    onCategoryUpdated={mockOnCategoryUpdated}
                />
            </MemoryRouter>
        )

        await userEvent.click(screen.getByRole('button', { name: /update category/i }))

        expect(await screen.findByText(/could not update category/i)).toBeInTheDocument()
        expect(mockOnCategoryUpdated).not.toHaveBeenCalled()
    })
})
