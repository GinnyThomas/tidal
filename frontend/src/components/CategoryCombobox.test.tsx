// components/CategoryCombobox.test.tsx

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import CategoryCombobox from './CategoryCombobox'

const categories = [
    { id: 'cat-animals', name: 'Animals', parent_category_id: null },
    { id: 'cat-dog', name: 'Dog food', parent_category_id: 'cat-animals' },
    { id: 'cat-travel', name: 'Travel', parent_category_id: null },
    { id: 'cat-animals-es', name: 'Animals (España)', parent_category_id: null },
    { id: 'cat-dog-es', name: 'Dog Food (España)', parent_category_id: 'cat-animals-es' },
]

describe('CategoryCombobox', () => {
    const onChange = vi.fn()

    afterEach(() => {
        vi.clearAllMocks()
    })

    it('renders with selected value (top-level) — shows name only', () => {
        render(
            <CategoryCombobox
                categories={categories}
                value="cat-travel"
                onChange={onChange}
            />
        )

        expect(screen.getByDisplayValue('Travel')).toBeInTheDocument()
    })

    it('renders with selected value (child) — shows "Parent → Child"', () => {
        render(
            <CategoryCombobox
                categories={categories}
                value="cat-dog"
                onChange={onChange}
            />
        )

        expect(screen.getByDisplayValue('Animals → Dog food')).toBeInTheDocument()
    })

    it('renders with no value — shows placeholder', () => {
        render(
            <CategoryCombobox
                categories={categories}
                value={null}
                onChange={onChange}
                placeholder="Pick one…"
            />
        )

        expect(screen.getByPlaceholderText('Pick one…')).toBeInTheDocument()
    })

    it('click opens the option list', async () => {
        render(
            <CategoryCombobox
                categories={categories}
                value={null}
                onChange={onChange}
            />
        )

        // Click the dropdown button to open
        await userEvent.click(screen.getByRole('button', { name: /open category options/i }))

        // Options should be visible
        expect(screen.getByRole('option', { name: /travel/i })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: /no category/i })).toBeInTheDocument()
    })

    it('type filters options (case-insensitive, substring match across parent + child)', async () => {
        render(
            <CategoryCombobox
                categories={categories}
                value={null}
                onChange={onChange}
            />
        )

        const input = screen.getByRole('combobox')
        // Focus and type to open + filter
        await userEvent.clear(input)
        await userEvent.type(input, 'dog')

        // Both dog food options match
        const options = screen.getAllByRole('option')
        const labels = options.map(o => o.textContent)
        expect(labels.some(l => l?.includes('Dog food'))).toBe(true)
        expect(labels.some(l => l?.includes('Dog Food (España)'))).toBe(true)
        // Travel should NOT be an option
        expect(labels.some(l => l?.includes('Travel'))).toBe(false)
    })

    it('arrow down + Enter selects the highlighted option and calls onChange', async () => {
        render(
            <CategoryCombobox
                categories={categories}
                value={null}
                onChange={onChange}
                includeNoCategory={false}
            />
        )

        const input = screen.getByRole('combobox')
        await userEvent.click(input)
        await userEvent.keyboard('{ArrowDown}{Enter}')

        expect(onChange).toHaveBeenCalled()
    })

    it('Escape closes without calling onChange', async () => {
        render(
            <CategoryCombobox
                categories={categories}
                value="cat-travel"
                onChange={onChange}
            />
        )

        const input = screen.getByRole('combobox')
        await userEvent.click(input)
        await userEvent.keyboard('{Escape}')

        expect(onChange).not.toHaveBeenCalled()
    })

    it('"— No category —" shown when includeNoCategory=true and no filter', async () => {
        render(
            <CategoryCombobox
                categories={categories}
                value={null}
                onChange={onChange}
                includeNoCategory={true}
            />
        )

        await userEvent.click(screen.getByRole('button', { name: /open category options/i }))
        expect(screen.getByRole('option', { name: /no category/i })).toBeInTheDocument()
    })

    it('"— No category —" hidden when required=true', async () => {
        render(
            <CategoryCombobox
                categories={categories}
                value={null}
                onChange={onChange}
                includeNoCategory={true}
                required={true}
            />
        )

        await userEvent.click(screen.getByRole('button', { name: /open category options/i }))
        expect(screen.queryByRole('option', { name: /no category/i })).not.toBeInTheDocument()
    })

    it('empty state "No matching categories" when filter has no results', async () => {
        render(
            <CategoryCombobox
                categories={categories}
                value={null}
                onChange={onChange}
            />
        )

        await userEvent.type(screen.getByRole('combobox'), 'xyznonexistent')

        expect(screen.getByText('No matching categories')).toBeInTheDocument()
    })

    it('disabled prop prevents interaction', () => {
        render(
            <CategoryCombobox
                categories={categories}
                value="cat-travel"
                onChange={onChange}
                disabled={true}
            />
        )

        expect(screen.getByRole('combobox')).toBeDisabled()
    })
})
