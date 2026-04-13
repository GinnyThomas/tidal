// components/AddCategoryForm.tsx
//
// Purpose: Form for creating or editing a category.
//          Styled as an ocean-800 card.
//
// Props:
//   topLevelCategories — list of parents for the dropdown (from CategoriesPage)
//   onCategoryAdded    — called after successful create
//   editingCategory    — (optional) when provided, the form is in edit mode:
//                        fields are pre-populated and PUT replaces POST
//   onCategoryUpdated  — (optional) called after successful update (edit mode)
//
// Design decisions:
//   - colour: native <input type="color"> for a browser colour picker.
//     Defaults to #0ea5e9 (sky-500 from our ocean design system).
//   - icon: emoji picker grid instead of a free-text field. Each button has
//     type="button" (critical — prevents form submission on click). The group
//     div has role="group" + aria-label so getByLabelText(/icon/i) works in
//     tests. aria-pressed signals the selected emoji to assistive technology.
//   - Edit mode: when editingCategory is provided, state initialises from
//     the existing values, button text changes to "Update Category", and the
//     request changes from POST to PUT. The parent should key this component
//     on editingCategory.id so switching to a different category always starts
//     fresh.

import axios from 'axios'
import { useState } from 'react'
import type { SyntheticEvent } from 'react'
import { getApiBaseUrl } from '../lib/api'

const EMOJI_OPTIONS = [
    '🏠', '🚗', '🍔', '💊', '🎮', '✈️', '💰', '🎓',
    '🎁', '💳', '📱', '⚡', '🛒', '👗', '💆', '🏋️',
    '🎵', '🐾', '🌱', '⭐', '🍕',
    '☕', '🍺', '🎬', '📚', '🏦', '🚂', '🚌', '⛽',
    '🏥', '💅', '🐶', '🎪', '🌍', '🔧', '🍷', '🎭',
    '💻', '📷', '🎨', '🏊', '🎯', '🧴', '🛁', '🧹',
    '🍰', '🌮', '🥗', '🏡', '🎠',
]

type ParentOption = {
    id: string
    name: string
}

type EditingCategory = {
    id: string
    name: string
    parent_category_id: string | null
    colour: string | null
    icon: string | null
    is_income: boolean
}

type Props = {
    topLevelCategories: ParentOption[]
    onCategoryAdded: () => void
    editingCategory?: EditingCategory
    onCategoryUpdated?: () => void
}

function AddCategoryForm({ topLevelCategories, onCategoryAdded, editingCategory, onCategoryUpdated }: Props) {
    const isEditMode = editingCategory !== undefined

    // Initialise from editingCategory in edit mode; use defaults for create.
    const [name, setName] = useState(editingCategory?.name ?? '')
    const [parentId, setParentId] = useState(editingCategory?.parent_category_id ?? '')
    // Default colour is sky-500 (#0ea5e9) — ties the form to our ocean palette.
    const [colour, setColour] = useState(editingCategory?.colour ?? '#0ea5e9')
    const [icon, setIcon] = useState(editingCategory?.icon ?? '')
    const [isIncome, setIsIncome] = useState(editingCategory?.is_income ?? false)
    const [error, setError] = useState<string | null>(null)
    // Tracks in-flight submission — disables the button to prevent double-submit.
    const [isSubmitting, setIsSubmitting] = useState(false)

    const handleSubmit = async (e: SyntheticEvent) => {
        e.preventDefault()
        if (isSubmitting) return
        setIsSubmitting(true)
        setError(null)
        const token = localStorage.getItem('access_token')
        const body = {
            name,
            parent_category_id: parentId || null,
            colour: colour || null,
            icon: icon || null,
            is_income: isIncome,
        }
        const config = { headers: { Authorization: `Bearer ${token}` } }

        try {
            if (isEditMode && editingCategory) {
                await axios.put(
                    `${getApiBaseUrl()}/api/v1/categories/${editingCategory.id}`,
                    body,
                    config,
                )
                onCategoryUpdated?.()
            } else {
                await axios.post(`${getApiBaseUrl()}/api/v1/categories`, body, config)
                onCategoryAdded()
            }
        } catch {
            setError(
                isEditMode
                    ? 'Could not update category. Please try again.'
                    : 'Could not create category. Please try again.'
            )
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="bg-ocean-800 border border-ocean-700 rounded-xl p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-200 mb-5">
                {isEditMode ? 'Edit Category' : 'New Category'}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="categoryName" className="label-base">Category Name</label>
                    <input
                        id="categoryName"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="input-base"
                        required
                    />
                </div>

                <div>
                    <label htmlFor="parentCategory" className="label-base">Parent Category</label>
                    <select
                        id="parentCategory"
                        value={parentId}
                        onChange={(e) => setParentId(e.target.value)}
                        className="input-base"
                    >
                        <option value="">— None (top-level) —</option>
                        {topLevelCategories.map((cat) => (
                            <option key={cat.id} value={cat.id}>
                                {cat.name}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Colour — native browser colour picker, default sky-500 */}
                <div>
                    <label htmlFor="colour" className="label-base">Colour (optional)</label>
                    <input
                        id="colour"
                        type="color"
                        value={colour}
                        onChange={(e) => setColour(e.target.value)}
                        className="h-10 w-16 cursor-pointer rounded border border-ocean-700 bg-ocean-900"
                    />
                </div>

                {/* Icon — emoji picker grid.
                    role="group" + aria-label lets getByLabelText(/icon/i) find this element.
                    type="button" on each emoji button is critical — without it, clicking
                    an emoji would submit the form. */}
                <div>
                    <span className="label-base block mb-2">Icon (optional)</span>
                    <div role="group" aria-label="Icon (optional)" className="flex flex-wrap gap-1.5">
                        <button
                            type="button"
                            onClick={() => setIcon('')}
                            aria-pressed={icon === ''}
                            className={`px-2 py-1 rounded text-xs border transition-colors cursor-pointer ${
                                icon === ''
                                    ? 'border-sky-500 bg-sky-500/20 text-sky-400'
                                    : 'border-ocean-600 text-slate-400 hover:border-ocean-500 hover:text-slate-200'
                            }`}
                        >
                            None
                        </button>
                        {EMOJI_OPTIONS.map((emoji) => (
                            <button
                                key={emoji}
                                type="button"
                                onClick={() => setIcon(emoji)}
                                aria-pressed={icon === emoji}
                                className={`w-9 h-9 rounded text-lg flex items-center justify-center border transition-colors cursor-pointer ${
                                    icon === emoji
                                        ? 'border-sky-500 bg-sky-500/20'
                                        : 'border-ocean-600 hover:border-ocean-500'
                                }`}
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Income category toggle */}
                <div>
                    <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={isIncome}
                            onChange={(e) => setIsIncome(e.target.checked)}
                            className="accent-sky-500"
                        />
                        Income category (adds to cash flow balance)
                    </label>
                </div>

                {error && (
                    <div className="bg-coral-500/10 border border-coral-500/30 rounded-lg px-3 py-2">
                        <p className="text-coral-400 text-sm">{error}</p>
                    </div>
                )}

                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="btn-primary w-full cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isSubmitting ? 'Saving...' : (isEditMode ? 'Update Category' : 'Save Category')}
                </button>
            </form>
        </div>
    )
}

export default AddCategoryForm
