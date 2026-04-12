// pages/MonthlyPlanView.tsx
//
// Purpose: The primary view — monthly plan table showing planned vs actual
//          vs remaining vs pending, grouped by category.
//          Wrapped in Layout for navigation.
//
// Features:
//   - Expand/collapse: categories with schedules show a ▼/▶ toggle. When
//     expanded, individual schedule rows appear beneath the category row
//     showing each schedule's name and planned contribution.
//   - All categories with schedules are expanded by default so the user
//     sees the full breakdown on first load.
//
// IMPORTANT: Several inline styles MUST remain as inline styles (not Tailwind
// classes) because tests assert them via toHaveStyle():
//   remainingStyle() — returns { color: 'green' | 'red' | 'grey' }
//   child cell       — style={{ paddingLeft: '2rem' }}
// jsdom does not compute CSS class rules, only inline styles.

import axios from 'axios'
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import React from 'react'
import { Link } from 'react-router-dom'
import Layout from '../components/Layout'
import AddReallocationForm from '../components/AddReallocationForm'
import { annualPlanCache } from '../lib/annualPlanCache'
import { getApiBaseUrl } from '../lib/api'
import { GROUP_ORDER } from '../lib/budgetGroups'


// --- TypeScript types matching the backend MonthlyPlan response ---

type ScheduleRow = {
    schedule_id: string
    schedule_name: string
    planned: string
}

type PlanRow = {
    category_id: string
    category_name: string
    parent_category_id: string | null
    planned: string
    actual: string
    remaining: string
    pending: string
    schedules: ScheduleRow[]
    group: string | null
}

type MonthlyPlan = {
    year: number
    month: number
    rows: PlanRow[]
    total_planned: string
    total_actual: string
    total_remaining: string
    total_pending: string
}


// --- Month navigation helper ---

function shiftMonth(year: number, month: number, delta: -1 | 1): { year: number; month: number } {
    const date = new Date(year, month - 1 + delta)
    return { year: date.getFullYear(), month: date.getMonth() + 1 }
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
]
function formatMonth(year: number, month: number): string {
    return `${MONTH_NAMES[month - 1]} ${year}`
}


// --- Remaining colour ---
//
// Returns an inline style object — MUST stay inline because tests use
// toHaveStyle({ color: 'rgb(0, 128, 0)' }) etc. Tailwind classes are not
// evaluated by jsdom's style engine.

function remainingStyle(remaining: string): CSSProperties {
    const value = parseFloat(remaining)
    if (value > 0) return { color: 'green' }
    if (value < 0) return { color: 'red' }
    return { color: 'grey' }
}


// =============================================================================
// Component
// =============================================================================

function MonthlyPlanView() {
    const now = new Date()
    const [year, setYear] = useState(now.getFullYear())
    const [month, setMonth] = useState(now.getMonth() + 1)

    const [plan, setPlan] = useState<MonthlyPlan | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    // Tracks which categories are expanded to show individual schedule rows.
    // Default: all categories with schedules are expanded (set on fetch).
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
    // Budget group filter — "All" means no filter, otherwise passes ?group= to API
    const [filterGroup, setFilterGroup] = useState('')
    // Reallocation form — which category is being reallocated from (null = form closed)
    const [reallocatingFrom, setReallocatingFrom] = useState<PlanRow | null>(null)
    // Reallocation history for the current month
    type Reallocation = {
        id: string
        from_category_id: string
        to_category_id: string
        amount: string
        reason: string
    }
    const [reallocations, setReallocations] = useState<Reallocation[]>([])

    const fetchPlan = async (y: number, m: number, group: string = '') => {
        const token = localStorage.getItem('access_token')
        setLoading(true)
        setError(null)
        try {
            const params: Record<string, string> = {}
            if (group) params.group = group
            const response = await axios.get(`${getApiBaseUrl()}/api/v1/plan/${y}/${m}`, {
                headers: { Authorization: `Bearer ${token}` },
                params,
            })
            setPlan(response.data)
            // Default: expand all categories that have schedules
            const withSchedules = new Set(
                (response.data.rows as PlanRow[])
                    .filter(r => r.schedules && r.schedules.length > 0)
                    .map(r => r.category_id)
            )
            setExpandedCategories(withSchedules)
        } catch {
            setError('Could not load plan. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { fetchPlan(year, month, filterGroup) }, [year, month, filterGroup])

    // Fetch reallocation history for the current month
    const fetchReallocations = () => {
        const token = localStorage.getItem('access_token')
        setReallocations([])
        axios.get(`${getApiBaseUrl()}/api/v1/reallocations`, {
            headers: { Authorization: `Bearer ${token}` },
            params: { year, month },
        }).then(res => setReallocations(res.data)).catch(() => setReallocations([]))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { fetchReallocations() }, [year, month])

    const handleReallocationAdded = () => {
        setReallocatingFrom(null)
        annualPlanCache.clear()
        fetchPlan(year, month, filterGroup)
        fetchReallocations()
    }

    const handlePrev = () => {
        const prev = shiftMonth(year, month, -1)
        setYear(prev.year)
        setMonth(prev.month)
    }

    const handleNext = () => {
        const next = shiftMonth(year, month, 1)
        setYear(next.year)
        setMonth(next.month)
    }

    // Toggle a category's expand/collapse state
    const toggleExpand = (categoryId: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev)
            if (next.has(categoryId)) {
                next.delete(categoryId)
            } else {
                next.add(categoryId)
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

    // --- Build hierarchical row order ---

    const rows = plan?.rows ?? []
    const rowIds = new Set(rows.map(r => r.category_id))
    const parentRows = rows.filter(
        r => r.parent_category_id === null || !rowIds.has(r.parent_category_id)
    )
    const childrenOf = (parentId: string) =>
        rows.filter(r => r.parent_category_id === parentId)

    const totals = plan ? {
        planned: plan.total_planned,
        actual: plan.total_actual,
        remaining: plan.total_remaining,
        pending: plan.total_pending,
    } : null

    // --- Group sections (when no group filter is active) ---
    //
    // Each row uses its OWN group field (from its budget) first.
    // Children with group=null are treated as belonging to their parent's
    // group section (not emitted under "General" separately).
    // If a parent has no group but its children span multiple groups,
    // the parent appears in each child-group section with matching children.
    //
    // The data structure is: { group, entries[] } where each entry is
    // { parent, children } — the children subset that belongs to this group.

    const getRowGroup = (row: PlanRow): string => row.group ?? 'General'

    type GroupEntry = { parent: PlanRow; children: PlanRow[] }
    type GroupSection = { group: string; entries: GroupEntry[] }

    const groupedSections: GroupSection[] = []

    if (!filterGroup) {
        const byGroup = new Map<string, GroupEntry[]>()

        for (const parent of parentRows) {
            const children = childrenOf(parent.category_id)
            const parentGroup = parent.group

            if (children.length === 0) {
                // Leaf parent (no children) — use its own group
                const g = getRowGroup(parent)
                if (!byGroup.has(g)) byGroup.set(g, [])
                byGroup.get(g)!.push({ parent, children: [] })
            } else {
                // Parent with children — group children by their own group.
                // The parent appears in each group section that has matching children.
                const childrenByGroup = new Map<string, PlanRow[]>()
                for (const child of children) {
                    const cg = getRowGroup(child)
                    if (!childrenByGroup.has(cg)) childrenByGroup.set(cg, [])
                    childrenByGroup.get(cg)!.push(child)
                }

                if (parentGroup) {
                    // Parent has its own group — show it there with all children
                    // that match, plus any "General" children (no group of their own)
                    const matching = childrenByGroup.get(parentGroup) ?? []
                    const general = parentGroup !== 'General' ? (childrenByGroup.get('General') ?? []) : []
                    if (!byGroup.has(parentGroup)) byGroup.set(parentGroup, [])
                    byGroup.get(parentGroup)!.push({ parent, children: [...matching, ...general] })

                    // Children with OTHER groups go to their own sections
                    for (const [cg, cgChildren] of childrenByGroup) {
                        if (cg !== parentGroup && cg !== 'General') {
                            if (!byGroup.has(cg)) byGroup.set(cg, [])
                            byGroup.get(cg)!.push({ parent, children: cgChildren })
                        }
                    }
                } else {
                    // Parent has no group — appears in each child group section
                    for (const [cg, cgChildren] of childrenByGroup) {
                        if (!byGroup.has(cg)) byGroup.set(cg, [])
                        byGroup.get(cg)!.push({ parent, children: cgChildren })
                    }
                }
            }
        }

        for (const g of GROUP_ORDER) {
            const entries = byGroup.get(g)
            if (entries && entries.length > 0) {
                groupedSections.push({ group: g, entries })
            }
        }
        // Any groups not in GROUP_ORDER (defensive)
        for (const [g, entries] of byGroup) {
            if (!(GROUP_ORDER as readonly string[]).includes(g) && entries.length > 0) {
                groupedSections.push({ group: g, entries })
            }
        }
    }

    // Renders individual schedule rows beneath a category when expanded.
    // Each row shows the schedule name and its planned contribution.
    // Actual, remaining, and pending are shown as "—" since we don't track
    // per-schedule actuals (only per-category).
    const renderScheduleRows = (row: PlanRow, indent: string) => {
        if (!expandedCategories.has(row.category_id) || !row.schedules?.length) return null
        return row.schedules.map(s => (
            <tr
                key={s.schedule_id}
                className="border-b border-ocean-700/30 bg-ocean-900/30"
            >
                <td className={`${indent} py-2 text-slate-400 text-sm italic`}>
                    {s.schedule_name}
                </td>
                <td className="px-4 py-2 text-right text-sky-400/60 text-sm">{s.planned}</td>
                <td className="px-4 py-2 text-right text-slate-500 text-sm">—</td>
                <td className="px-4 py-2 text-right text-slate-500 text-sm">—</td>
                <td className="px-4 py-2 text-right text-slate-500 text-sm">—</td>
            </tr>
        ))
    }

    // Renders a parent category row with its schedule breakdown and a specific
    // set of child rows. When called from the grouped path, `children` is the
    // subset matching that group section. When called from the flat path
    // (filtered view), `children` is all children of the parent.
    // The optional `groupKey` suffix ensures unique React keys when the same
    // parent appears in multiple group sections.
    const renderParentAndChildren = (parent: PlanRow, children?: PlanRow[], groupKey?: string) => {
        const actualChildren = children ?? childrenOf(parent.category_id)
        const hasSchedules = parent.schedules?.length > 0
        const isExpanded = expandedCategories.has(parent.category_id)
        const key = groupKey ? `${parent.category_id}-${groupKey}` : parent.category_id
        return (
            <React.Fragment key={key}>
                {/* Parent row */}
                <tr className="border-b border-ocean-700 hover:bg-ocean-700/40 transition-colors">
                    <td className="px-4 py-3 text-slate-100 font-medium">
                        <div className="flex items-center gap-2">
                            <div className="flex items-center">
                                {hasSchedules && (
                                    <button
                                        onClick={() => toggleExpand(parent.category_id)}
                                        className="mr-2 text-slate-400 hover:text-sky-400 transition-colors cursor-pointer text-xs"
                                        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${parent.category_name}`}
                                    >
                                        {isExpanded ? '▼' : '▶'}
                                    </button>
                                )}
                                {parent.category_name}
                            </div>
                            <button
                                onClick={() => setReallocatingFrom(parent)}
                                className="text-xs px-1.5 py-0.5 rounded text-slate-500 hover:text-sky-400 hover:bg-ocean-700 transition-colors cursor-pointer"
                                aria-label={`Reallocate from ${parent.category_name}`}
                            >
                                Reallocate
                            </button>
                        </div>
                    </td>
                    <td className="px-4 py-3 text-right text-sky-400">
                        {parseFloat(parent.planned) !== 0 ? (
                            <Link to="/schedules" className="hover:underline">{parent.planned}</Link>
                        ) : parent.planned}
                    </td>
                    <td className="px-4 py-3 text-right text-teal-400">
                        {parseFloat(parent.actual) !== 0 ? (
                            <Link to={`/transactions?category_id=${parent.category_id}&status=cleared`} className="hover:underline">
                                {parent.actual}
                            </Link>
                        ) : parent.actual}
                    </td>
                    <td
                        className="px-4 py-3 text-right font-medium"
                        style={remainingStyle(parent.remaining)}
                    >
                        {parent.remaining}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400">
                        {parseFloat(parent.pending) !== 0 ? (
                            <Link to={`/transactions?category_id=${parent.category_id}&status=pending`} className="hover:underline cursor-pointer">
                                {parent.pending}
                            </Link>
                        ) : parent.pending}
                    </td>
                </tr>

                {/* Schedule breakdown rows — shown when parent is expanded */}
                {renderScheduleRows(parent, 'pl-6 pr-4')}

                {/* Child rows — paddingLeft inline style MUST stay (test assertion) */}
                {actualChildren.map(child => {
                    const childHasSchedules = child.schedules?.length > 0
                    const childIsExpanded = expandedCategories.has(child.category_id)
                    return (
                        <React.Fragment key={child.category_id}>
                            <tr className="border-b border-ocean-700/50 bg-ocean-800/50 hover:bg-ocean-700/30 transition-colors">
                                <td
                                    className="px-4 py-2.5 text-slate-300 text-sm"
                                    style={{ paddingLeft: '2rem' }}
                                >
                                    <div className="flex items-center gap-2">
                                        <div className="flex items-center">
                                            {childHasSchedules && (
                                                <button
                                                    onClick={() => toggleExpand(child.category_id)}
                                                    className="mr-2 text-slate-400 hover:text-sky-400 transition-colors cursor-pointer text-xs"
                                                    aria-label={`${childIsExpanded ? 'Collapse' : 'Expand'} ${child.category_name}`}
                                                >
                                            {childIsExpanded ? '▼' : '▶'}
                                        </button>
                                            )}
                                            {child.category_name}
                                        </div>
                                        <button
                                            onClick={() => setReallocatingFrom(child)}
                                            className="text-xs px-1.5 py-0.5 rounded text-slate-500 hover:text-sky-400 hover:bg-ocean-700 transition-colors cursor-pointer"
                                            aria-label={`Reallocate from ${child.category_name}`}
                                        >
                                            Reallocate
                                        </button>
                                    </div>
                                </td>
                                <td className="px-4 py-2.5 text-right text-sky-400/80 text-sm">
                                    {parseFloat(child.planned) !== 0 ? (
                                        <Link to="/schedules" className="hover:underline">{child.planned}</Link>
                                    ) : child.planned}
                                </td>
                                <td className="px-4 py-2.5 text-right text-teal-400/80 text-sm">
                                    {parseFloat(child.actual) !== 0 ? (
                                        <Link to={`/transactions?category_id=${child.category_id}&status=cleared`} className="hover:underline">
                                            {child.actual}
                                        </Link>
                                    ) : child.actual}
                                </td>
                                <td
                                    className="px-4 py-2.5 text-right text-sm"
                                    style={remainingStyle(child.remaining)}
                                >
                                    {child.remaining}
                                </td>
                                <td className="px-4 py-2.5 text-right text-slate-400 text-sm">
                                    {parseFloat(child.pending) !== 0 ? (
                                        <Link to={`/transactions?category_id=${child.category_id}&status=pending`} className="hover:underline cursor-pointer">
                                            {child.pending}
                                        </Link>
                                    ) : child.pending}
                                </td>
                            </tr>
                            {renderScheduleRows(child, 'pl-10 pr-4')}
                        </React.Fragment>
                    )
                })}
            </React.Fragment>
        )
    }

    return (
        <Layout>
            <div className="max-w-5xl mx-auto">

                {/* Month navigation — h2 required by tests (getByRole heading level 2) */}
                <div className="flex items-center justify-between mb-6">
                    <button
                        onClick={handlePrev}
                        className="bg-ocean-800 hover:bg-ocean-700 border border-ocean-600 text-slate-300 hover:text-sky-400 px-4 py-2 rounded-lg transition-colors cursor-pointer text-sm font-medium"
                    >
                        {'< Prev'}
                    </button>
                    <h2 className="text-2xl font-bold text-slate-100" style={{ display: 'inline', margin: '0 1rem' }}>
                        {formatMonth(year, month)}
                    </h2>
                    <button
                        onClick={handleNext}
                        className="bg-ocean-800 hover:bg-ocean-700 border border-ocean-600 text-slate-300 hover:text-sky-400 px-4 py-2 rounded-lg transition-colors cursor-pointer text-sm font-medium"
                    >
                        {'Next >'}
                    </button>
                </div>

                {/* Budget group filter */}
                <div className="flex justify-end mb-4">
                    <div>
                        <label htmlFor="filterGroup" className="label-base">Budget group</label>
                        <select
                            id="filterGroup"
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

                {/* Reallocation form — shown when a Reallocate button is clicked */}
                {reallocatingFrom && (
                    <div className="mb-6">
                        <AddReallocationForm
                            key={reallocatingFrom.category_id}
                            fromCategoryId={reallocatingFrom.category_id}
                            fromCategoryName={reallocatingFrom.category_name}
                            year={year}
                            month={month}
                            maxAmount={reallocatingFrom.remaining}
                            onReallocationAdded={handleReallocationAdded}
                            onCancel={() => setReallocatingFrom(null)}
                        />
                    </div>
                )}

                {rows.length === 0 ? (
                    <div className="text-center py-20">
                        <p aria-hidden="true" className="text-5xl mb-4">📊</p>
                        <p className="text-slate-400 text-lg">
                            No activity this month. Add a schedule or transaction to get started.
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-xl border border-ocean-700 bg-ocean-800">
                        <table className="w-full text-sm min-w-[480px]">
                            <thead>
                                <tr className="border-b border-ocean-700 bg-ocean-950">
                                    <th className="text-left px-4 py-3 text-slate-400 font-medium">Category</th>
                                    <th className="text-right px-4 py-3 text-sky-400 font-medium">Planned</th>
                                    <th className="text-right px-4 py-3 text-teal-400 font-medium">Actual</th>
                                    <th className="text-right px-4 py-3 text-slate-400 font-medium">Remaining</th>
                                    <th className="text-right px-4 py-3 font-medium" style={{ color: '#f59e0b' }}>Pending</th>
                                </tr>
                            </thead>
                            <tbody>
                                {/* Render grouped sections only when "All" is selected AND there
                                    are multiple distinct groups. A single group (e.g. only "General")
                                    doesn't benefit from section headers. */}
                                {!filterGroup && groupedSections.length > 1 ? (
                                    groupedSections.map(({ group: sectionGroup, entries }) => {
                                        // Compute subtotals for all rows in this group section.
                                        // Include both parent rows and their children.
                                        const allSectionRows = entries.flatMap(({ parent, children }) => [parent, ...children])
                                        const subPlanned = allSectionRows.reduce((s, r) => s + parseFloat(r.planned), 0)
                                        const subActual = allSectionRows.reduce((s, r) => s + parseFloat(r.actual), 0)
                                        const subRemaining = subPlanned - subActual
                                        const subPending = allSectionRows.reduce((s, r) => s + parseFloat(r.pending), 0)
                                        const fmt2 = (v: number) => v === 0 ? '—' : v.toFixed(2)

                                        return (
                                            <React.Fragment key={sectionGroup}>
                                                {/* Group section header */}
                                                <tr className="bg-ocean-950/60">
                                                    <td colSpan={5} className="px-4 py-2 text-slate-500 text-xs font-semibold tracking-wider uppercase">
                                                        ── {sectionGroup} ──
                                                    </td>
                                                </tr>
                                                {entries.map(({ parent, children }) =>
                                                    renderParentAndChildren(parent, children, sectionGroup)
                                                )}
                                                {/* Group subtotal row */}
                                                <tr className="bg-ocean-700/40 border-b border-ocean-600">
                                                    <td className="px-4 py-2.5 text-slate-300 font-semibold text-sm">
                                                        ── {sectionGroup} Total
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right text-sky-400 font-semibold text-sm">
                                                        {fmt2(subPlanned)}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right text-teal-400 font-semibold text-sm">
                                                        {fmt2(subActual)}
                                                    </td>
                                                    <td
                                                        className="px-4 py-2.5 text-right font-semibold text-sm"
                                                        style={remainingStyle(subRemaining.toFixed(2))}
                                                    >
                                                        {fmt2(subRemaining)}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right font-semibold text-sm" style={{ color: '#f59e0b' }}>
                                                        {fmt2(subPending)}
                                                    </td>
                                                </tr>
                                            </React.Fragment>
                                        )
                                    })
                                ) : (
                                    parentRows.map(parent => renderParentAndChildren(parent))
                                )}
                            </tbody>

                            {/* Totals footer */}
                            {totals && (
                                <tfoot>
                                    <tr className="border-t-2 border-ocean-600 bg-ocean-950">
                                        <td className="px-4 py-3 text-slate-100 font-bold">Total</td>
                                        <td className="px-4 py-3 text-right text-sky-400 font-bold">{totals.planned}</td>
                                        <td className="px-4 py-3 text-right text-teal-400 font-bold">{totals.actual}</td>
                                        <td
                                            className="px-4 py-3 text-right font-bold"
                                            style={remainingStyle(totals.remaining)}
                                        >
                                            {totals.remaining}
                                        </td>
                                        <td className="px-4 py-3 text-right text-slate-400 font-bold">{totals.pending}</td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                )}

                {/* Reallocation history for this month */}
                {reallocations.length > 0 && (
                    <div className="mt-6">
                        <h3 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wider">
                            Reallocations this month
                        </h3>
                        {/* Build name lookup once rather than calling rows.find() per entry */}
                        {(() => {
                            const catNameMap = new Map(rows.map(r => [r.category_id, r.category_name]))
                            return (
                        <ul className="space-y-2">
                            {reallocations.map(r => {
                                const fromName = catNameMap.get(r.from_category_id) ?? r.from_category_id
                                const toName = catNameMap.get(r.to_category_id) ?? r.to_category_id
                                return (
                                    <li key={r.id} className="text-sm text-slate-300 bg-ocean-800 border border-ocean-700 rounded-lg px-4 py-2.5">
                                        <span className="text-sky-400 font-medium">{r.amount}</span>
                                        {' moved from '}
                                        <span className="text-slate-100">{fromName}</span>
                                        {' to '}
                                        <span className="text-slate-100">{toName}</span>
                                        {' — '}
                                        <span className="text-slate-400 italic">{r.reason}</span>
                                    </li>
                                )
                            })}
                        </ul>
                            )
                        })()}
                    </div>
                )}
            </div>
        </Layout>
    )
}

export default MonthlyPlanView
