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
import { getApiBaseUrl } from '../lib/api'


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
                                {parentRows.map(parent => {
                                    const hasSchedules = parent.schedules?.length > 0
                                    const isExpanded = expandedCategories.has(parent.category_id)
                                    return (
                                        <React.Fragment key={parent.category_id}>
                                            {/* Parent row */}
                                            <tr className="border-b border-ocean-700 hover:bg-ocean-700/40 transition-colors">
                                                <td className="px-4 py-3 text-slate-100 font-medium">
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
                                                </td>
                                                {/* Non-zero planned amounts link to /schedules.
                                                    TODO: link to /schedules?category_id=xxx once schedule filtering is added. */}
                                                <td className="px-4 py-3 text-right text-sky-400">
                                                    {parseFloat(parent.planned) !== 0 ? (
                                                        <Link to="/schedules" className="hover:underline">{parent.planned}</Link>
                                                    ) : parent.planned}
                                                </td>
                                                <td className="px-4 py-3 text-right text-teal-400">
                                                    {/* Non-zero actual links to transactions filtered by this category */}
                                                    {parseFloat(parent.actual) !== 0 ? (
                                                        <Link to={`/transactions?category_id=${parent.category_id}`} className="hover:underline">
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
                                                <td className="px-4 py-3 text-right text-slate-400">{parent.pending}</td>
                                            </tr>

                                            {/* Schedule breakdown rows — shown when parent is expanded */}
                                            {renderScheduleRows(parent, 'pl-6 pr-4')}

                                            {/* Child rows — paddingLeft inline style MUST stay (test assertion) */}
                                            {childrenOf(parent.category_id).map(child => {
                                                const childHasSchedules = child.schedules?.length > 0
                                                const childIsExpanded = expandedCategories.has(child.category_id)
                                                return (
                                                    <React.Fragment key={child.category_id}>
                                                        <tr
                                                            className="border-b border-ocean-700/50 bg-ocean-800/50 hover:bg-ocean-700/30 transition-colors"
                                                        >
                                                            <td
                                                                className="px-4 py-2.5 text-slate-300 text-sm"
                                                                style={{ paddingLeft: '2rem' }}
                                                            >
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
                                                            </td>
                                                            <td className="px-4 py-2.5 text-right text-sky-400/80 text-sm">
                                                                {parseFloat(child.planned) !== 0 ? (
                                                                    <Link to="/schedules" className="hover:underline">{child.planned}</Link>
                                                                ) : child.planned}
                                                            </td>
                                                            <td className="px-4 py-2.5 text-right text-teal-400/80 text-sm">
                                                                {parseFloat(child.actual) !== 0 ? (
                                                                    <Link to={`/transactions?category_id=${child.category_id}`} className="hover:underline">
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
                                                            <td className="px-4 py-2.5 text-right text-slate-400 text-sm">{child.pending}</td>
                                                        </tr>

                                                        {/* Schedule breakdown rows for child category */}
                                                        {renderScheduleRows(child, 'pl-10 pr-4')}
                                                    </React.Fragment>
                                                )
                                            })}
                                        </React.Fragment>
                                    )
                                })}
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
            </div>
        </Layout>
    )
}

export default MonthlyPlanView
