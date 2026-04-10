// pages/CategoriesPage.tsx
//
// Purpose: Hierarchical category list with ocean-themed styling.
//          Wrapped in Layout for navigation.
//
// Design decisions:
//   - Parent categories styled as section headers (semibold, full-width card)
//   - Child categories indented with a teal-500 left border
//   - Hidden categories keep their inline opacity:0.4 style (tests verify this)
//   - "Show Hidden"/"Hide Hidden" button uses exact text (tests use exact match)
//   - "Hide"/"Unhide" per-category buttons use exact text (tests use exact match)
//   - The <li>/<ul> hierarchy is preserved for DOM query tests

import axios from 'axios'
import { useEffect, useState } from 'react'
import Layout from '../components/Layout'
import AddCategoryForm from '../components/AddCategoryForm'
import { getApiBaseUrl } from '../lib/api'

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
    const [editingCategory, setEditingCategory] = useState<Category | null>(null)
    const [includeHidden, setIncludeHidden] = useState(false)

    const fetchCategories = async (withHidden: boolean) => {
        const token = localStorage.getItem('access_token')
        setLoading(true)
        setError(null)
        try {
            const response = await axios.get(`${getApiBaseUrl()}/api/v1/categories`, {
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
                `${getApiBaseUrl()}/api/v1/categories/${categoryId}/toggle-visibility`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            )
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

    const handleEditCategory = (category: Category) => {
        // Close the add form so only one form is visible at a time
        setShowForm(false)
        setEditingCategory(category)
    }

    const handleCategoryUpdated = () => {
        setEditingCategory(null)
        fetchCategories(includeHidden)
    }

    // --- Early returns for terminal states ---

    if (loading) {
        return (
            <Layout>
                <p className="text-slate-400 text-center py-20 text-lg">Loading...</p>
            </Layout>
        )
    }

    if (error) {
        return (
            <Layout>
                <p className="text-coral-400 text-center py-20">{error}</p>
            </Layout>
        )
    }

    // --- Derive display structure from flat list ---

    // A category is a "parent" (top-level) if:
    //   a) it has no parent_category_id (it is genuinely a root category), OR
    //   b) its parent_category_id points to a category that isn't in the
    //      returned list (e.g. the parent is hidden and include_hidden=false).
    // Case (b) prevents children from silently disappearing when their parent
    // is hidden — they promote to top-level instead.
    // This is the same pattern used in MonthlyPlanView for plan rows.
    const categoryIds = new Set(categories.map((c) => c.id))
    const parents = categories.filter(
        (c) => c.parent_category_id === null || !categoryIds.has(c.parent_category_id)
    )
    const childrenOf = (parentId: string) =>
        categories.filter((c) => c.parent_category_id === parentId)

    // topLevelCategories is passed to AddCategoryForm for the parent dropdown.
    // We only offer genuinely root categories (parent_category_id === null) as
    // options — we don't support creating grandchild categories.
    const topLevelCategories = categories.filter((c) => c.parent_category_id === null)

    return (
        <Layout>
            <div className="max-w-4xl mx-auto">

                {/* Page header */}
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-slate-100">Categories</h2>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => { setShowForm((prev) => !prev); setEditingCategory(null) }}
                            className="btn-primary cursor-pointer"
                        >
                            Add Category
                        </button>
                        {/* Pill toggle — exact button text required by tests */}
                        <button
                            onClick={handleToggleHidden}
                            className="bg-ocean-700 hover:bg-ocean-600 border border-ocean-600 text-slate-300 hover:text-white px-4 py-2 rounded-full text-sm font-medium transition-colors cursor-pointer"
                        >
                            {includeHidden ? 'Hide Hidden' : 'Show Hidden'}
                        </button>
                    </div>
                </div>

                {/* Add form — shown when "Add Category" is toggled */}
                {showForm && (
                    <div className="mb-6">
                        <AddCategoryForm
                            topLevelCategories={topLevelCategories}
                            onCategoryAdded={handleCategoryAdded}
                        />
                    </div>
                )}

                {/* Edit form — shown when an Edit button is clicked.
                    keyed on id so switching to a different category remounts with fresh state. */}
                {editingCategory && (
                    <div className="mb-6">
                        <AddCategoryForm
                            key={editingCategory.id}
                            topLevelCategories={topLevelCategories}
                            onCategoryAdded={() => {}}
                            editingCategory={editingCategory}
                            onCategoryUpdated={handleCategoryUpdated}
                        />
                    </div>
                )}

                {/* Category list / empty state */}
                {/* grid-cols-1 on mobile, 2-column on md+. self-start prevents
                    short cards from stretching to match their taller neighbour. */}
                {categories.length === 0 ? (
                    <div className="text-center py-20">
                        <p aria-hidden="true" className="text-5xl mb-4">📂</p>
                        <p className="text-slate-400 text-lg">
                            No visible categories. You may have hidden categories; click "Show Hidden" to
                            view them or add one to get started.
                        </p>
                    </div>
                ) : (
                    <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {parents.map((parent) => {
                            // Compute children once per parent.
                            // childrenOf iterates the entire categories array, so
                            // calling it twice (length check + map) would do double
                            // the work. Block-body form lets us declare this const
                            // before the return without needing an IIFE.
                            const children = childrenOf(parent.id)
                            return (
                                // Inline opacity style is required — the test asserts
                                // toHaveStyle({ opacity: '0.4' }) on the <li> element.
                                <li
                                    key={parent.id}
                                    style={parent.is_hidden ? { opacity: 0.4 } : {}}
                                    className="bg-ocean-800 border border-ocean-700 rounded-xl overflow-hidden self-start"
                                >
                                    {/* Parent row — styled as section header */}
                                    <div className="flex items-center justify-between px-4 py-3">
                                        <span className="font-semibold text-slate-100">
                                            {parent.icon && <span className="mr-2">{parent.icon}</span>}
                                            {parent.name}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => handleEditCategory(parent)}
                                                className="text-xs px-2.5 py-1 rounded border border-ocean-600 text-slate-400 hover:text-slate-200 hover:border-sky-500 transition-colors cursor-pointer"
                                            >
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => handleToggleVisibility(parent.id)}
                                                className="text-xs px-2.5 py-1 rounded border border-ocean-600 text-slate-400 hover:text-slate-200 hover:border-sky-500 transition-colors cursor-pointer"
                                            >
                                                {parent.is_hidden ? 'Unhide' : 'Hide'}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Child rows — teal left border for visual hierarchy */}
                                    {children.length > 0 && (
                                        <ul className="border-t border-ocean-700 divide-y divide-ocean-700/50">
                                            {children.map((child) => (
                                                <li
                                                    key={child.id}
                                                    style={child.is_hidden ? { opacity: 0.4 } : {}}
                                                    className="flex items-center justify-between pl-6 pr-4 py-2.5 border-l-2 border-teal-500 ml-4"
                                                >
                                                    <span className="text-slate-300 text-sm">
                                                        {child.icon && <span className="mr-1.5">{child.icon}</span>}
                                                        {child.name}
                                                    </span>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => handleEditCategory(child)}
                                                            className="text-xs px-2 py-0.5 rounded border border-ocean-600 text-slate-400 hover:text-slate-200 hover:border-sky-500 transition-colors cursor-pointer"
                                                        >
                                                            Edit
                                                        </button>
                                                        <button
                                                            onClick={() => handleToggleVisibility(child.id)}
                                                            className="text-xs px-2 py-0.5 rounded border border-ocean-600 text-slate-400 hover:text-slate-200 hover:border-sky-500 transition-colors cursor-pointer"
                                                        >
                                                            {child.is_hidden ? 'Unhide' : 'Hide'}
                                                        </button>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </li>
                            )
                        })}
                    </ul>
                )}
            </div>
        </Layout>
    )
}

export default CategoriesPage
