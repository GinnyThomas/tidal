// components/CategoryCombobox.tsx
//
// Purpose: Searchable, accessible category picker using Headless UI Combobox.
//          Replaces native <select> for categories across all forms.
//
// Features:
//   - Type to filter by category name or parent name (substring, case-insensitive)
//   - Hierarchical labels: "Parent → Child" for subcategories
//   - Optional "— No category —" option. When chosen, the input stays empty and
//     shows it as a placeholder, so clicking in and typing searches immediately
//   - Clicking into a chosen category selects all its text, so typing replaces it
//   - Clicking in opens the list: scroll and pick, or type to filter. Tabbing in
//     leaves it closed, so Enter still submits the form (ArrowDown opens it)
//   - Full keyboard navigation (arrow keys, Enter, Escape)
//   - ARIA roles handled by Headless UI

import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions } from '@headlessui/react'
import { useMemo, useRef, useState } from 'react'

const NO_CATEGORY_LABEL = '— No category —'

type Category = {
    id: string
    name: string
    parent_category_id?: string | null
}

interface CategoryComboboxProps {
    categories: Category[]
    value: string | null
    onChange: (id: string | null) => void
    includeNoCategory?: boolean
    placeholder?: string
    disabled?: boolean
    required?: boolean
    id?: string
    ariaLabel?: string
}

type ComboboxItem = {
    id: string | null
    label: string
    searchText: string
    parentName: string | null
    childName: string | null
}

function buildComboboxItems(categories: Category[], includeNoCategory: boolean): ComboboxItem[] {
    const idSet = new Set(categories.map(c => c.id))
    const items: ComboboxItem[] = []

    if (includeNoCategory) {
        items.push({ id: null, label: NO_CATEGORY_LABEL, searchText: 'no category', parentName: null, childName: null })
    }

    // Build parent → children map in one pass
    const childrenByParent = new Map<string, Category[]>()
    for (const c of categories) {
        if (c.parent_category_id && idSet.has(c.parent_category_id)) {
            const list = childrenByParent.get(c.parent_category_id) ?? []
            list.push(c)
            childrenByParent.set(c.parent_category_id, list)
        }
    }
    // Sort each children list
    for (const list of childrenByParent.values()) {
        list.sort((a, b) => a.name.localeCompare(b.name))
    }

    const parents = categories
        .filter(c => !c.parent_category_id || !idSet.has(c.parent_category_id))
        .sort((a, b) => a.name.localeCompare(b.name))

    for (const p of parents) {
        items.push({
            id: p.id,
            label: p.name,
            searchText: p.name.toLowerCase(),
            parentName: null,
            childName: null,
        })
        for (const c of (childrenByParent.get(p.id) ?? [])) {
            items.push({
                id: c.id,
                label: `${p.name} → ${c.name}`,
                searchText: `${p.name} ${c.name}`.toLowerCase(),
                parentName: p.name,
                childName: c.name,
            })
        }
    }

    return items
}

function CategoryCombobox({
    categories,
    value,
    onChange,
    includeNoCategory = true,
    placeholder,
    disabled = false,
    required = false,
    id,
    ariaLabel,
}: CategoryComboboxProps) {
    const [query, setQuery] = useState('')
    // True between the mousedown that focuses the input and its mouseup: that
    // mouseup would otherwise collapse the select-all to a caret. A second click
    // while already focused places the caret as normal.
    const justFocused = useRef(false)
    const buttonRef = useRef<HTMLButtonElement>(null)

    const showNoCategory = includeNoCategory && !required
    const allItems = useMemo(
        () => buildComboboxItems(categories, showNoCategory),
        [categories, showNoCategory]
    )

    const filtered = query === ''
        ? allItems
        : allItems.filter(item => item.searchText.includes(query.toLowerCase()))

    const selectedItem = allItems.find(item => item.id === value) ?? null
    const effectivePlaceholder = placeholder ?? (showNoCategory ? NO_CATEGORY_LABEL : 'Select category…')

    return (
        <Combobox
            value={selectedItem}
            onChange={(item: ComboboxItem | null) => {
                onChange(item?.id ?? null)
                setQuery('')
            }}
            onClose={() => setQuery('')}
            disabled={disabled}
        >
            {({ open }) => (
                <div className="relative">
                    <ComboboxInput
                        id={id}
                        className="input-base w-full pr-8"
                        // "No category" is the absence of a value: show it as the placeholder,
                        // not as editable text
                        displayValue={(item: ComboboxItem | null) => item?.id ? item.label : ''}
                        onChange={(e) => setQuery(e.target.value)}
                        onFocus={(e) => e.currentTarget.select()}
                        onMouseDown={(e) => {
                            justFocused.current = document.activeElement !== e.currentTarget
                        }}
                        onMouseUp={(e) => {
                            if (justFocused.current) {
                                e.preventDefault()
                                justFocused.current = false
                            }
                        }}
                        // Open on click (not on focus, which Tab also gives) so you can
                        // scroll and pick without typing; the select-all still lets you
                        // type over. Headless UI has no open() for the input, so press
                        // the button for it
                        onClick={() => {
                            if (!open) buttonRef.current?.click()
                        }}
                        placeholder={effectivePlaceholder}
                        aria-label={ariaLabel}
                        required={required}
                        aria-required={required || undefined}
                    />
                    <ComboboxButton
                        ref={buttonRef}
                        className="absolute inset-y-0 right-0 flex items-center pr-2"
                        aria-label="Open category options"
                    >
                        <span className="text-slate-400 text-xs">▼</span>
                    </ComboboxButton>
                    <ComboboxOptions className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-ocean-600 bg-ocean-800 py-1 shadow-lg">
                        {filtered.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-slate-500">No matching categories</div>
                        ) : (
                            filtered.map((item) => (
                                <ComboboxOption
                                    key={item.id ?? '__no_category__'}
                                    value={item}
                                    className={({ focus }) =>
                                        `cursor-pointer select-none px-3 py-1.5 text-sm ${
                                            focus ? 'bg-sky-500/20 text-sky-400' : 'text-slate-300'
                                        }`
                                    }
                                >
                                    {({ selected }) => (
                                        <span className="flex items-center gap-2">
                                            {item.childName ? (
                                                <>
                                                    <span className="text-slate-500">{item.parentName}</span>
                                                    <span className="text-slate-500">→</span>
                                                    <span>{item.childName}</span>
                                                </>
                                            ) : (
                                                <span className={item.id === null ? 'text-slate-400 italic' : ''}>{item.label}</span>
                                            )}
                                            {selected && <span className="ml-auto text-sky-400">✓</span>}
                                        </span>
                                    )}
                                </ComboboxOption>
                            ))
                        )}
                    </ComboboxOptions>
                </div>
            )}
        </Combobox>
    )
}

export default CategoryCombobox
