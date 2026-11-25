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

    it('query state is cleared after selection — reopening shows full list', async () => {
        render(
            <CategoryCombobox
                categories={categories}
                value={null}
                onChange={onChange}
                includeNoCategory={false}
            />
        )

        const input = screen.getByRole('combobox')
        // Open and filter to narrow the list
        await userEvent.click(screen.getByRole('button', { name: /open category options/i }))
        await userEvent.type(input, 'dog')

        // Only dog-related options visible
        let options = screen.getAllByRole('option')
        expect(options.length).toBe(2) // Dog food + Dog Food (España)

        // Select one
        await userEvent.click(options[0])

        // Reopen — full list should be visible (query cleared)
        await userEvent.click(screen.getByRole('button', { name: /open category options/i }))
        options = screen.getAllByRole('option')
        // All 5 categories should be available (no "No category" since includeNoCategory=false)
        expect(options.length).toBe(5)
    })

    // "No category" is the absence of a value, so the input stays empty and the
    // label is a placeholder — clicking in never drops the caret inside real text.
    it('no category selected — input is empty with "No category" placeholder', () => {
        render(
            <CategoryCombobox
                categories={categories}
                value={null}
                onChange={onChange}
            />
        )

        const input = screen.getByRole('combobox')
        expect(input).toHaveValue('')
        expect(input).toHaveAttribute('placeholder', '— No category —')
    })

    it('required with no value — placeholder asks to select a category', () => {
        render(
            <CategoryCombobox
                categories={categories}
                value={null}
                onChange={onChange}
                required={true}
            />
        )

        expect(screen.getByRole('combobox')).toHaveAttribute('placeholder', 'Select category…')
    })

    it('typing with no category selected searches straight away', async () => {
        render(
            <CategoryCombobox
                categories={categories}
                value={null}
                onChange={onChange}
            />
        )

        const input = screen.getByRole('combobox')
        await userEvent.click(input)
        await userEvent.keyboard('trav')

        expect(input).toHaveValue('trav')
        expect(screen.getByRole('option', { name: /travel/i })).toBeInTheDocument()
    })

    it('clicking into a selected category selects all its text', async () => {
        render(
            <CategoryCombobox
                categories={categories}
                value="cat-dog"
                onChange={onChange}
            />
        )

        const input = screen.getByRole('combobox') as HTMLInputElement
        await userEvent.click(input)

        expect(input.selectionStart).toBe(0)
        expect(input.selectionEnd).toBe('Animals → Dog food'.length)
    })

    it('typing after clicking into a selected category replaces it', async () => {
        render(
            <CategoryCombobox
                categories={categories}
                value="cat-dog"
                onChange={onChange}
            />
        )

        const input = screen.getByRole('combobox')
        await userEvent.click(input)
        await userEvent.keyboard('trav')

        expect(input).toHaveValue('trav')
    })

    it('clicking into the input opens the full option list', async () => {
        render(
            <CategoryCombobox
                categories={categories}
                value="cat-travel"
                onChange={onChange}
            />
        )

        await userEvent.click(screen.getByRole('combobox'))

        // Full list (not filtered by the selected label), text still selected
        expect(screen.getAllByRole('option')).toHaveLength(6) // 5 categories + No category
        const input = screen.getByRole('combobox') as HTMLInputElement
        expect(input.selectionEnd! - input.selectionStart!).toBe('Travel'.length)
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
