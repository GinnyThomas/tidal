// pages/CategoriesPage.test.tsx
//
// Purpose: Tests for CategoriesPage — the hierarchical categories list view.
//
// Test coverage:
//   - Four render states: loading, error, empty, list
//   - Hierarchical rendering: parent contains its children in the DOM
//   - Add Category button and form toggle
//   - Re-fetch after a category is added
//   - Show Hidden toggle re-fetches with include_hidden=true
//   - HideButton calls PATCH toggle-visibility and re-fetches
//   - Hidden categories are visually distinct (opacity) when include_hidden=true
//
// axios is mocked globally — no real HTTP requests made.
// localStorage holds the fake JWT each test needs.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import CategoriesPage from './CategoriesPage'

vi.mock('axios')

// Minimal category object matching CategoryResponse from the backend.
const makeCategory = (overrides: Record<string, unknown> = {}) => ({
    id: 'cat-1',
    name: 'Food & Drink',
    parent_category_id: null,
    colour: null,
    icon: null,
    is_system: true,
    is_hidden: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
})

describe('CategoriesPage', () => {
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
        vi.mocked(axios.get).mockReturnValueOnce(new Promise<never>(() => {}))

        render(<MemoryRouter><CategoriesPage /></MemoryRouter>)

        expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })

    it('renders categories hierarchically after a successful fetch', async () => {
        const parent = makeCategory({ id: 'parent-1', name: 'Food & Drink', parent_category_id: null })
        const child = makeCategory({ id: 'child-1', name: 'Groceries', parent_category_id: 'parent-1' })

        vi.mocked(axios.get).mockResolvedValueOnce({ data: [parent, child] })

        render(<MemoryRouter><CategoriesPage /></MemoryRouter>)

        expect(await screen.findByText('Food & Drink')).toBeInTheDocument()
        expect(screen.getByText('Groceries')).toBeInTheDocument()

        // Groceries should be nested inside the Food & Drink list item
        const parentLi = screen.getByText('Food & Drink').closest('li')
        expect(parentLi).toContainElement(screen.getByText('Groceries'))
    })

    it('shows an empty-state message when the user has no categories', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [] })

        render(<MemoryRouter><CategoriesPage /></MemoryRouter>)

        expect(await screen.findByText(/no visible categories./i)).toBeInTheDocument()
    })

    it('shows an error message when the fetch fails', async () => {
        vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network error'))

        render(<MemoryRouter><CategoriesPage /></MemoryRouter>)

        expect(await screen.findByText(/could not load categories/i)).toBeInTheDocument()
    })

    // =========================================================================
    // Add Category button
    // =========================================================================

    it('shows an Add Category button once categories have loaded', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [] })

        render(<MemoryRouter><CategoriesPage /></MemoryRouter>)

        expect(await screen.findByRole('button', { name: /add category/i })).toBeInTheDocument()
    })

    it('shows the AddCategoryForm when Add Category is clicked', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [] })

        render(<MemoryRouter><CategoriesPage /></MemoryRouter>)

        await userEvent.click(await screen.findByRole('button', { name: /add category/i }))

        expect(screen.getByLabelText(/category name/i)).toBeInTheDocument()
    })

    it('hides the AddCategoryForm when Add Category is clicked a second time', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [] })

        render(<MemoryRouter><CategoriesPage /></MemoryRouter>)

        const button = await screen.findByRole('button', { name: /add category/i })
        await userEvent.click(button) // show
        await userEvent.click(button) // hide

        expect(screen.queryByLabelText(/category name/i)).not.toBeInTheDocument()
    })

    // =========================================================================
    // Integration: form submission triggers re-fetch
    // =========================================================================

    it('re-fetches the categories list and hides the form after onCategoryAdded fires', async () => {
        // First call: initial load (no categories)
        // Second call: after the form adds one
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [makeCategory({ name: 'Side Hustle', parent_category_id: null })] })

        vi.mocked(axios.post).mockResolvedValueOnce({ data: { id: 'cat-new' } })

        render(<MemoryRouter><CategoriesPage /></MemoryRouter>)
        await screen.findByText(/no visible categories./i)

        await userEvent.click(screen.getByRole('button', { name: /add category/i }))
        await userEvent.type(screen.getByLabelText(/category name/i), 'Side Hustle')
        await userEvent.click(screen.getByRole('button', { name: /save category/i }))

        expect(await screen.findByText('Side Hustle')).toBeInTheDocument()
        expect(screen.queryByLabelText(/category name/i)).not.toBeInTheDocument()
    })

    // =========================================================================
    // Show Hidden toggle
    // =========================================================================

    it('re-fetches with include_hidden=true when Show Hidden is clicked', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })  // initial load
            .mockResolvedValueOnce({ data: [] })  // after toggle

        render(<MemoryRouter><CategoriesPage /></MemoryRouter>)
        await screen.findByText(/no visible categories./i)

        await userEvent.click(screen.getByRole('button', { name: 'Show Hidden' }))

        await waitFor(() => {
            expect(vi.mocked(axios.get)).toHaveBeenCalledTimes(2)
            expect(vi.mocked(axios.get)).toHaveBeenLastCalledWith(
                'http://localhost:8000/api/v1/categories',
                expect.objectContaining({
                    params: { include_hidden: true },
                })
            )
        })
    })

    it('changes the toggle button label to Hide Hidden when show hidden is active', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [] })

        render(<MemoryRouter><CategoriesPage /></MemoryRouter>)
        await screen.findByText(/no visible categories./i)

        await userEvent.click(screen.getByRole('button', { name: 'Show Hidden' }))

        expect(await screen.findByRole('button', { name: 'Hide Hidden' })).toBeInTheDocument()
    })

    // =========================================================================
    // Hide button (per-row toggle-visibility)
    // =========================================================================

    it('clicking Hide calls toggle-visibility and re-fetches the list', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeCategory({ id: 'cat-1', name: 'Food & Drink' })] })
            .mockResolvedValueOnce({ data: [] }) // category is hidden, disappears from default list

        vi.mocked(axios.patch).mockResolvedValueOnce({
            data: makeCategory({ id: 'cat-1', name: 'Food & Drink', is_hidden: true }),
        })

        render(<MemoryRouter><CategoriesPage /></MemoryRouter>)
        await screen.findByText('Food & Drink')

        await userEvent.click(screen.getByRole('button', { name: 'Hide' }))

        expect(vi.mocked(axios.patch)).toHaveBeenCalledWith(
            'http://localhost:8000/api/v1/categories/cat-1/toggle-visibility',
            {},
            expect.objectContaining({ headers: { Authorization: 'Bearer fake-token' } })
        )

        // After re-fetch returns empty, the category is gone
        await waitFor(() => {
            expect(screen.queryByText('Food & Drink')).not.toBeInTheDocument()
        })
    })

    // =========================================================================
    // Visual distinction for hidden categories
    // =========================================================================

    it('hidden categories appear greyed out when Show Hidden is active', async () => {
        const visible = makeCategory({ id: 'cat-1', name: 'Visible Category', is_hidden: false })
        const hidden = makeCategory({ id: 'cat-2', name: 'Hidden Category', is_hidden: true })

        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [visible] })            // initial load
            .mockResolvedValueOnce({ data: [visible, hidden] })    // after toggling show hidden

        render(<MemoryRouter><CategoriesPage /></MemoryRouter>)
        await screen.findByText('Visible Category')

        await userEvent.click(screen.getByRole('button', { name: 'Show Hidden' }))

        // Hidden category appears after the re-fetch
        const hiddenText = await screen.findByText('Hidden Category')

        // The li wrapping the hidden category should have reduced opacity
        expect(hiddenText.closest('li')).toHaveStyle({ opacity: '0.4' })
    })
})
