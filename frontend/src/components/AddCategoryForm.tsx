// components/AddCategoryForm.tsx
//
// Purpose: Form for creating a new category.
//          Styled as an ocean-800 card.
//
// Props:
//   topLevelCategories — list of parents for the dropdown (from CategoriesPage)
//   onCategoryAdded   — called after successful submit

import axios from 'axios'
import { useState } from 'react'
import type { SyntheticEvent } from 'react'
import { getApiBaseUrl } from '../lib/api'

type ParentOption = {
    id: string
    name: string
}

type Props = {
    topLevelCategories: ParentOption[]
    onCategoryAdded: () => void
}

function AddCategoryForm({ topLevelCategories, onCategoryAdded }: Props) {
    const [name, setName] = useState('')
    const [parentId, setParentId] = useState('')
    const [colour, setColour] = useState('')
    const [icon, setIcon] = useState('')
    const [error, setError] = useState<string | null>(null)

    const handleSubmit = async (e: SyntheticEvent) => {
        e.preventDefault()
        setError(null)
        const token = localStorage.getItem('access_token')
        try {
            await axios.post(
                `${getApiBaseUrl()}/api/v1/categories`,
                {
                    name,
                    parent_category_id: parentId || null,
                    colour: colour || null,
                    icon: icon || null,
                },
                { headers: { Authorization: `Bearer ${token}` } }
            )
            onCategoryAdded()
        } catch {
            setError('Could not create category. Please try again.')
        }
    }

    return (
        <div className="bg-ocean-800 border border-ocean-700 rounded-xl p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-200 mb-5">New Category</h3>

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

                <div>
                    <label htmlFor="colour" className="label-base">Colour (optional)</label>
                    <input
                        id="colour"
                        type="text"
                        value={colour}
                        onChange={(e) => setColour(e.target.value)}
                        className="input-base"
                        placeholder="#RRGGBB"
                        maxLength={7}
                    />
                </div>

                <div>
                    <label htmlFor="icon" className="label-base">Icon (optional)</label>
                    <input
                        id="icon"
                        type="text"
                        value={icon}
                        onChange={(e) => setIcon(e.target.value)}
                        className="input-base"
                    />
                </div>

                {error && (
                    <div className="bg-coral-500/10 border border-coral-500/30 rounded-lg px-3 py-2">
                        <p className="text-coral-400 text-sm">{error}</p>
                    </div>
                )}

                <button
                    type="submit"
                    className="btn-primary w-full cursor-pointer"
                >
                    Save Category
                </button>
            </form>
        </div>
    )
}

export default AddCategoryForm
