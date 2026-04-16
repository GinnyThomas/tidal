// pages/BudgetsPage.tsx
//
// Purpose: Budget management — list, create, edit, delete budgets and
//          manage monthly overrides.
//          Wrapped in Layout for navigation.
//
// Features:
//   - Year selector (prev/next buttons), defaults to current year
//   - Group filter dropdown: All / UK / España
//   - Table: Category | Default Monthly | Currency | Group | Actions
//   - Add Budget button opens AddBudgetForm
//   - Edit button pre-populates AddBudgetForm
//   - Delete button with confirmation
//   - Overrides expand button shows BudgetOverrideForm inline

import axios from 'axios'
import React, { useEffect, useRef, useState } from 'react'
import Layout from '../components/Layout'
import AddBudgetForm from '../components/AddBudgetForm'
import BudgetOverrideForm from '../components/BudgetOverrideForm'
import { annualPlanCache } from '../lib/annualPlanCache'
import { getApiBaseUrl } from '../lib/api'
import { GROUP_ORDER } from '../lib/budgetGroups'

// --- TypeScript types ---

type BudgetOverride = {
    id: string
    budget_id: string
    month: number
    amount: string
}

type Budget = {
    id: string
    user_id: string
    category_id: string
    // parent_category_id is denormalised from the related Category row by
    // the backend so the client can render parent/child hierarchy without
    // a second fetch. null for top-level categories.
    parent_category_id: string | null
    year: number
    default_amount: string
    currency: string
    group: string | null
    notes?: string | null
    created_at: string
    updated_at: string
    overrides: BudgetOverride[]
}

type Category = {
    id: string
    name: string
}

// =============================================================================
// Component
// =============================================================================

function BudgetsPage() {
    const [year, setYear] = useState(new Date().getFullYear())
    const [filterGroup, setFilterGroup] = useState('')
    const [budgets, setBudgets] = useState<Budget[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [showForm, setShowForm] = useState(false)
    const [editingBudget, setEditingBudget] = useState<Budget | null>(null)
    const editFormRef = useRef<HTMLDivElement>(null)
    // Tracks which budget IDs have their overrides expanded
    const [expandedOverrides, setExpandedOverrides] = useState<Set<string>>(new Set())
    const [refreshKey, setRefreshKey] = useState(0)

    // Fetch budgets for the selected year (and optional group filter)
    useEffect(() => {
        const token = localStorage.getItem('access_token')
        setLoading(true)
        setError(null)
        const params: Record<string, string | number> = { year }
        if (filterGroup) params.group = filterGroup
        axios.get(`${getApiBaseUrl()}/api/v1/budgets`, {
            headers: { Authorization: `Bearer ${token}` },
            params,
        }).then(res => {
            setBudgets(res.data)
        }).catch(() => {
            setError('Could not load budgets. Please try again.')
        }).finally(() => {
            setLoading(false)
        })
    }, [year, filterGroup, refreshKey])

    // Fetch categories once for the name lookup
    useEffect(() => {
        const token = localStorage.getItem('access_token')
        axios.get(`${getApiBaseUrl()}/api/v1/categories`, {
            headers: { Authorization: `Bearer ${token}` },
        }).then(res => {
            setCategories(res.data)
        }).catch(() => {})
    }, [])

    // Build category name lookup
    const categoryById = new Map(categories.map(c => [c.id, c.name]))

    // --- Group sections (when no group filter is active) ---
    const groupedBudgets: { group: string; items: Budget[] }[] = []
    if (!filterGroup && budgets.length > 0) {
        const byGroup = new Map<string, Budget[]>()
        for (const b of budgets) {
            const g = b.group ?? 'General'
            if (!byGroup.has(g)) byGroup.set(g, [])
            byGroup.get(g)!.push(b)
        }
        for (const g of GROUP_ORDER) {
            const items = byGroup.get(g)
            if (items && items.length > 0) groupedBudgets.push({ group: g, items })
        }
        for (const [g, items] of byGroup) {
            if (!(GROUP_ORDER as readonly string[]).includes(g) && items.length > 0) groupedBudgets.push({ group: g, items })
        }
    }
    const showGroupSections = !filterGroup && groupedBudgets.length > 1

    // Render a single budget row. When isChild=true the Category cell is
    // indented with a teal left border, matching the parent/child hierarchy
    // styling used in AnnualView and CategoriesPage. Top-level (parent)
    // budgets render the category name in bold.
    const renderBudgetRow = (budget: Budget, isChild: boolean = false) => (
        <tr
            key={budget.id}
            className="border-b border-ocean-700/50 cursor-pointer hover:bg-ocean-700/30 transition-colors"
            onClick={(e) => {
                const target = e.target as HTMLElement
                if (target.closest('button, a, input, select, textarea, [role="button"]')) {
                    return
                }
                handleEdit(budget)
            }}
            aria-label="Click to edit"
        >
            <td className={`${isChild ? 'pl-10 pr-4 border-l-2 border-teal-500' : 'px-4'} py-3`}>
                <div className="flex items-center gap-2">
                    <button
                        onClick={(e) => {
                            // Stop propagation — the <tr> has a click-to-edit
                            // handler that would otherwise scroll the page to
                            // the edit form when the user only wanted to
                            // expand the inline overrides section.
                            e.stopPropagation()
                            toggleOverrides(budget.id)
                        }}
                        className="text-slate-400 hover:text-sky-400 transition-colors cursor-pointer text-xs"
                        aria-label={`${expandedOverrides.has(budget.id) ? 'Collapse' : 'Expand'} overrides for ${categoryById.get(budget.category_id) ?? budget.category_id}`}
                    >
                        {expandedOverrides.has(budget.id) ? '▼' : '▶'}
                    </button>
                    <span className={isChild ? "text-slate-300" : "font-semibold text-slate-100"}>
                        {categoryById.get(budget.category_id) ?? budget.category_id}
                    </span>
                </div>
                {budget.notes && (
                    <p className="text-xs text-slate-400 italic mt-0.5">{budget.notes}</p>
                )}
                {expandedOverrides.has(budget.id) && (
                    // stopPropagation so interactions with the inline override
                    // form don't bubble up to the row-level click-to-edit
                    // handler (which would scroll the page to the top form).
                    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                        <BudgetOverrideForm
                            budgetId={budget.id}
                            overrides={budget.overrides}
                            defaultAmount={budget.default_amount}
                            onChanged={() => {
                                annualPlanCache.clear()
                                setRefreshKey(k => k + 1)
                            }}
                        />
                    </div>
                )}
            </td>
            <td className="px-4 py-3 text-right text-sky-400 font-medium">
                {budget.default_amount}
            </td>
            <td className="px-4 py-3 text-center text-slate-300">
                {budget.currency}
            </td>
            <td className="px-4 py-3 text-center text-slate-400">
                {budget.group ?? '—'}
            </td>
            <td className="px-4 py-3 text-center">
                <div className="flex items-center justify-center gap-2">
                    <button
                        onClick={() => handleEdit(budget)}
                        aria-label={`Edit budget for ${categoryById.get(budget.category_id) ?? budget.category_id}`}
                        className="text-xs px-2.5 py-1 rounded border border-ocean-600 text-slate-400 hover:text-slate-200 hover:border-sky-500 transition-colors cursor-pointer"
                    >
                        Edit
                    </button>
                    <button
                        onClick={() => handleDelete(budget.id)}
                        aria-label={`Delete budget for ${categoryById.get(budget.category_id) ?? budget.category_id}`}
                        className="text-xs px-2.5 py-1 rounded border border-ocean-600 text-slate-400 hover:text-coral-400 hover:border-coral-500 transition-colors cursor-pointer"
                    >
                        Delete
                    </button>
                </div>
            </td>
        </tr>
    )

    // Render a synthetic parent header — used when a group contains a child
    // budget whose parent has no budget of its own. Non-clickable (no edit
    // row behaviour), "—" for the numeric columns, and no action buttons.
    const renderSyntheticParentRow = (categoryId: string, name: string) => (
        <tr key={`synthetic-parent-${categoryId}`} className="border-b border-ocean-700/50">
            <td className="px-4 py-3">
                <span className="font-semibold text-slate-100">{name}</span>
            </td>
            <td className="px-4 py-3 text-right text-slate-500">—</td>
            <td className="px-4 py-3 text-center text-slate-500">—</td>
            <td className="px-4 py-3 text-center text-slate-500">—</td>
            <td className="px-4 py-3 text-center text-slate-500">—</td>
        </tr>
    )

    // Build the parent/child sections for a given group's budgets.
    //
    // A "section" is a parent category plus its child budgets within the
    // group. The parent may have its own budget (parentBudget is set) or
    // be synthetic (parentBudget is null — child exists but parent has no
    // budget in this group).
    //
    // Synthetic parents are included for every child whose parent is not
    // itself a top-level budget in the group, matching the pattern in
    // AnnualView/CategoriesPage where the hierarchy stays intact even when
    // a parent category has no direct activity.
    //
    // Sorting: parents alphabetical by category name, children alphabetical
    // within each parent.
    type Section = {
        parentId: string
        parentName: string
        parentBudget: Budget | null
        children: Budget[]
    }
    const buildSections = (items: Budget[]): Section[] => {
        const sectionMap = new Map<string, Section>()
        const ensureSection = (pid: string): Section => {
            if (!sectionMap.has(pid)) {
                sectionMap.set(pid, {
                    parentId: pid,
                    parentName: categoryById.get(pid) ?? pid,
                    parentBudget: null,
                    children: [],
                })
            }
            return sectionMap.get(pid)!
        }
        // First pass: top-level budgets become their own section's parent.
        for (const b of items) {
            if (b.parent_category_id === null) {
                ensureSection(b.category_id).parentBudget = b
            }
        }
        // Second pass: child budgets get attached to their parent's section.
        // If the parent isn't a top-level budget in this group, the section
        // is created as a synthetic parent (parentBudget stays null).
        for (const b of items) {
            if (b.parent_category_id !== null) {
                ensureSection(b.parent_category_id).children.push(b)
            }
        }
        const sections = [...sectionMap.values()]
        // Sort parents alphabetically by name; sort each parent's children too.
        sections.sort((a, b) => a.parentName.localeCompare(b.parentName))
        for (const s of sections) {
            s.children.sort((a, b) => {
                const na = categoryById.get(a.category_id) ?? a.category_id
                const nb = categoryById.get(b.category_id) ?? b.category_id
                return na.localeCompare(nb)
            })
        }
        return sections
    }

    const renderGroupItems = (items: Budget[]) =>
        buildSections(items).flatMap((s) => {
            const parentRow = s.parentBudget
                ? renderBudgetRow(s.parentBudget, false)
                : renderSyntheticParentRow(s.parentId, s.parentName)
            const childRows = s.children.map((c) => renderBudgetRow(c, true))
            return [parentRow, ...childRows]
        })

    const handleBudgetSaved = () => {
        setShowForm(false)
        setEditingBudget(null)
        setRefreshKey(k => k + 1)
        annualPlanCache.clear()
    }

    const handleEdit = (budget: Budget) => {
        setShowForm(false)
        setEditingBudget(budget)
        setTimeout(() => editFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    }

    const handleDelete = async (budgetId: string) => {
        if (!window.confirm('Delete this budget? This cannot be undone.')) return
        const token = localStorage.getItem('access_token')
        try {
            await axios.delete(`${getApiBaseUrl()}/api/v1/budgets/${budgetId}`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            setRefreshKey(k => k + 1)
            annualPlanCache.clear()
        } catch {
            // Silent failure
        }
    }

    const toggleOverrides = (budgetId: string) => {
        setExpandedOverrides(prev => {
            const next = new Set(prev)
            if (next.has(budgetId)) {
                next.delete(budgetId)
            } else {
                next.add(budgetId)
            }
            return next
        })
    }

    // --- Early returns ---

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

    return (
        <Layout>
            <div className="max-w-5xl mx-auto">

                {/* Page header */}
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-slate-100">Budgets</h2>
                    <button
                        onClick={() => {
                            setShowForm(prev => !prev)
                            setEditingBudget(null)
                        }}
                        className="btn-primary cursor-pointer"
                    >
                        Add Budget
                    </button>
                </div>

                {/* Year selector + group filter */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setYear(y => y - 1)}
                            className="bg-ocean-800 hover:bg-ocean-700 border border-ocean-600 text-slate-300 hover:text-sky-400 px-3 py-1.5 rounded-lg transition-colors cursor-pointer text-sm font-medium"
                        >
                            {'< Prev'}
                        </button>
                        <span className="text-lg font-bold text-slate-100">{year}</span>
                        <button
                            onClick={() => setYear(y => y + 1)}
                            className="bg-ocean-800 hover:bg-ocean-700 border border-ocean-600 text-slate-300 hover:text-sky-400 px-3 py-1.5 rounded-lg transition-colors cursor-pointer text-sm font-medium"
                        >
                            {'Next >'}
                        </button>
                    </div>
                    <div>
                        <label htmlFor="budgetGroupFilter" className="label-base">Group</label>
                        <select
                            id="budgetGroupFilter"
                            value={filterGroup}
                            onChange={(e) => setFilterGroup(e.target.value)}
                            className="input-base"
                        >
                            <option value="">All</option>
                            <option value="UK">UK</option>
                            <option value="España">España</option>
                        </select>
                    </div>
                </div>

                {/* Add form */}
                {showForm && (
                    <div className="mb-6">
                        <AddBudgetForm
                            onBudgetSaved={handleBudgetSaved}
                            defaultYear={year}
                        />
                    </div>
                )}

                {/* Edit form */}
                {editingBudget && (
                    <div ref={editFormRef} className="mb-6">
                        <AddBudgetForm
                            key={editingBudget.id}
                            onBudgetSaved={handleBudgetSaved}
                            editingBudget={editingBudget}
                        />
                    </div>
                )}

                {/* Budget list / empty state */}
                {budgets.length === 0 ? (
                    <div className="text-center py-20">
                        <p aria-hidden="true" className="text-5xl mb-4">📋</p>
                        <p className="text-slate-400 text-lg">
                            No budgets for {year}. Add one to set monthly spending targets.
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-xl border border-ocean-700 bg-ocean-800">
                        <table className="w-full text-sm min-w-[640px]">
                            <thead>
                                <tr className="border-b border-ocean-700 bg-ocean-950">
                                    <th className="text-left px-4 py-3 text-slate-400 font-medium">Category</th>
                                    <th className="text-right px-4 py-3 text-sky-400 font-medium">Default Monthly</th>
                                    <th className="text-center px-4 py-3 text-slate-400 font-medium">Currency</th>
                                    <th className="text-center px-4 py-3 text-slate-400 font-medium">Group</th>
                                    <th className="text-center px-4 py-3 text-slate-400 font-medium">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {showGroupSections ? (
                                    groupedBudgets.map(({ group: sectionGroup, items }) => (
                                        <React.Fragment key={sectionGroup}>
                                            <tr className="bg-ocean-950/60">
                                                <td colSpan={5} className="px-4 py-2 text-slate-500 text-xs font-semibold tracking-wider uppercase">
                                                    ── {sectionGroup} ──
                                                </td>
                                            </tr>
                                            {renderGroupItems(items)}
                                        </React.Fragment>
                                    ))
                                ) : (
                                    renderGroupItems(budgets)
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </Layout>
    )
}

export default BudgetsPage
