// components/AddCategoryForm.tsx
//
// Purpose: Form for creating a new category.
//
// Props:
//   topLevelCategories — list of parent categories to populate the parent
//                        dropdown. Passed in from CategoriesPage, which already
//                        has the full list, so we avoid a second API call.
//   onCategoryAdded   — called by the parent (CategoriesPage) after a
//                       successful submit so it can re-fetch and hide this form.
//
// Design decisions:
//   - parent_category_id sends null when "None" is selected (default) so the
//     new category becomes top-level. A UUID string is sent when a parent is
//     chosen. The backend schema accepts Optional[uuid.UUID] = None.
//   - colour and icon are optional. We send null for empty strings — same
//     pattern as institution/note in AddAccountForm.
//   - is_system is never sent — user-created categories are always is_system=False.
//   - JWT comes from localStorage — same pattern as all other forms.

import axios from 'axios'
import { useState } from 'react'
import type { SyntheticEvent } from 'react'
import { getApiBaseUrl } from '../lib/api'


// Minimal shape needed to populate the parent dropdown.
// CategoriesPage passes the full Category objects but we only need id + name.
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
    // Empty string = no parent selected (top-level category).
    // A UUID string = the chosen parent's id.
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
                    // null = top-level. A non-empty string = child of that parent.
                    parent_category_id: parentId || null,
                    // Send null for empty optional strings — backend expects
                    // Optional[str] = None, not an empty string.
                    colour: colour || null,
                    icon: icon || null,
                },
                {
                    headers: { Authorization: `Bearer ${token}` },
                }
            )
            onCategoryAdded()
        } catch {
            setError('Could not create category. Please try again.')
        }
    }

    return (
        <form onSubmit={handleSubmit}>
            <label htmlFor="categoryName">Category Name</label>
            <input
                id="categoryName"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
            />

            {/* Parent dropdown — empty value = no parent (top-level category).
                Only top-level categories are offered as parents. This prevents
                nesting deeper than one level, which keeps the data model simple. */}
            <label htmlFor="parentCategory">Parent Category</label>
            <select
                id="parentCategory"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
            >
                <option value="">— None (top-level) —</option>
                {topLevelCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                        {cat.name}
                    </option>
                ))}
            </select>

            {/* Colour is an optional hex colour code e.g. "#FF5733".
                type="text" keeps the label simple — a colour picker can be
                added later as a UI enhancement. */}
            <label htmlFor="colour">Colour (optional)</label>
            <input
                id="colour"
                type="text"
                value={colour}
                onChange={(e) => setColour(e.target.value)}
                placeholder="#RRGGBB"
                maxLength={7}
            />

            <label htmlFor="icon">Icon (optional)</label>
            <input
                id="icon"
                type="text"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
            />

            {error && <p>{error}</p>}

            <button type="submit">Save Category</button>
        </form>
    )
}

export default AddCategoryForm
