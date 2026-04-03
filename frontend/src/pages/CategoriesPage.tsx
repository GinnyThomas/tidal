// pages/CategoriesPage.tsx
//
// Purpose: Displays the user's categories hierarchically and provides the
//          entry point for creating new ones and hiding/showing categories.
//
// Four render states:
//   loading  — fetch is in progress; no controls, no list
//   error    — fetch failed; no controls, error message shown
//   empty    — fetch succeeded but no categories; buttons shown
//   list     — fetch succeeded; buttons + hierarchical list shown
//
// Data flow:
//   1. On mount, fetchCategories(false) GETs /api/v1/categories with include_hidden=false.
//   2. "Add Category" toggles AddCategoryForm visibility.
//   3. "Show Hidden" / "Hide Hidden" re-fetches with include_hidden toggled.
//   4. Each category row has a Hide/Unhide button that PATCHes toggle-visibility
//      and then re-fetches so the list reflects the new state.
//   5. When AddCategoryForm calls onCategoryAdded(), we hide the form and
//      re-fetch the list.
//
// Hierarchy:
//   We receive a flat list from the API and group it client-side.
//   Parents = categories with parent_category_id === null.
//   Children = categories with a non-null parent_category_id, nested under
//   their parent's list item.
//
// Why not React Query?
//   Following the plain axios + useState pattern established in AccountsPage.
//   React Query can be introduced as a project-wide refactor later.

import axios from 'axios'
import { useEffect, useState } from 'react'
import AddCategoryForm from '../components/AddCategoryForm'


type Category = {
    id: string
    name: string
    parent_category_id: string | null
    colour: string | null
    icon: string | null
    is_system: boolean
    is_hidden: boolean
    created_at: string
}

function CategoriesPage() {
    const [categories, setCategories] = useState<Category[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [showForm, setShowForm] = useState(false)
    // includeHidden controls whether the API returns hidden categories too.
    // When false (default), hidden categories are filtered out server-side.
    const [includeHidden, setIncludeHidden] = useState(false)

    // fetchCategories takes an explicit withHidden parameter rather than
    // reading from state. This avoids the stale-closure problem when toggling:
    // if we called setIncludeHidden then fetchCategories(), the state update
    // would be batched and fetchCategories() would still read the old value.
    // Passing the value explicitly keeps the call synchronous and predictable.
    const fetchCategories = async (withHidden: boolean) => {
        const token = localStorage.getItem('access_token')
        setLoading(true)
        setError(null)
        try {
            const response = await axios.get(`${import.meta.env.VITE_API_URL}/api/v1/categories`, {
                headers: { Authorization: `Bearer ${token}` },
                params: { include_hidden: withHidden },
            })
            setCategories(response.data)
        } catch {
            setError('Could not load categories. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { fetchCategories(false) }, [])

    const handleToggleHidden = () => {
        const next = !includeHidden
        setIncludeHidden(next)
        fetchCategories(next)
    }

    const handleToggleVisibility = async (categoryId: string) => {
        const token = localStorage.getItem('access_token')
        try {
            await axios.patch(
                `${import.meta.env.VITE_API_URL}/api/v1/categories/${categoryId}/toggle-visibility`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            )
            // Re-fetch with the current include_hidden value so the list
            // reflects the change — e.g. hiding a category removes it from the
            // default view, or shows it greyed out if include_hidden is true.
            fetchCategories(includeHidden)
        } catch {
            window.alert('Could not update category visibility. Please try again.')
            fetchCategories(includeHidden)
        }
    }

    const handleCategoryAdded = () => {
        setShowForm(false)
        fetchCategories(includeHidden)
    }

    // --- Early returns for terminal states ---

    if (loading) {
        return <p>Loading...</p>
    }

    if (error) {
        return <p>{error}</p>
    }

    // --- Derive the display structure from the flat list ---

    // Parents are categories with no parent of their own (top-level).
    const parents = categories.filter((c) => c.parent_category_id === null)

    // childrenOf returns direct children of a given parent id.
    const childrenOf = (parentId: string) =>
        categories.filter((c) => c.parent_category_id === parentId)

    // Top-level categories are the candidates for the parent dropdown in the form.
    // We only offer top-level categories as parents — this keeps hierarchy to one
    // level deep, which is all the data model needs in Phase 3.
    const topLevelCategories = parents

    // --- Normal render: controls + optional form + list or empty state ---

    return (
        <div>
            <h2>Categories</h2>

            <button onClick={() => setShowForm((prev) => !prev)}>
                Add Category
            </button>

            {/* Toggle between showing only visible categories (default) and
                all categories including hidden ones. The button label reflects
                the action that clicking will take, not the current state. */}
            <button onClick={handleToggleHidden}>
                {includeHidden ? 'Hide Hidden' : 'Show Hidden'}
            </button>

            {showForm && (
                <AddCategoryForm
                    topLevelCategories={topLevelCategories}
                    onCategoryAdded={handleCategoryAdded}
                />
            )}

            {categories.length === 0 ? (
                <p>No visible categories. You may have hidden categories; click "Show Hidden" to
                    view them or add one to get started.</p>
            ) : (
                <ul>
                    {parents.map((parent) => (
                        // When include_hidden is true and this category is hidden,
                        // reduce opacity so it is visually distinct from visible ones.
                        <li
                            key={parent.id}
                            style={parent.is_hidden ? { opacity: 0.4 } : {}}
                        >
                            <span>{parent.name}</span>
                            <button onClick={() => handleToggleVisibility(parent.id)}>
                                {parent.is_hidden ? 'Unhide' : 'Hide'}
                            </button>

                            {/* Render direct children indented under the parent.
                                The nested <ul> provides the indentation and makes
                                the hierarchy clear in the DOM — useful for tests
                                and screen readers alike. */}
                            {childrenOf(parent.id).length > 0 && (
                                <ul>
                                    {childrenOf(parent.id).map((child) => (
                                        <li
                                            key={child.id}
                                            style={child.is_hidden ? { opacity: 0.4 } : {}}
                                        >
                                            <span>{child.name}</span>
                                            <button onClick={() => handleToggleVisibility(child.id)}>
                                                {child.is_hidden ? 'Unhide' : 'Hide'}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

export default CategoriesPage
