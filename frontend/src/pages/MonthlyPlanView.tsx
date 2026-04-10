// pages/MonthlyPlanView.tsx
//
// Purpose: The primary view — monthly plan table showing planned vs actual
//          vs remaining vs pending, grouped by category.
//          Wrapped in Layout for navigation.
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
import Layout from '../components/Layout'
import { getApiBaseUrl } from '../lib/api'


// --- TypeScript types matching the backend MonthlyPlan response ---

type PlanRow = {
    category_id: string
    category_name: string
    parent_category_id: string | null
    planned: string
    actual: string
    remaining: string
    pending: string
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

    const fetchPlan = async (y: number, m: number) => {
        const token = localStorage.getItem('access_token')
        setLoading(true)
        setError(null)
        try {
            const response = await axios.get(`${getApiBaseUrl()}/api/v1/plan/${y}/${m}`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            setPlan(response.data)
        } catch {
            setError('Could not load plan. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { fetchPlan(year, month) }, [year, month])

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
                                {parentRows.map(parent => (
                                    <React.Fragment key={parent.category_id}>
                                        {/* Parent row */}
                                        <tr className="border-b border-ocean-700 hover:bg-ocean-700/40 transition-colors">
                                            <td className="px-4 py-3 text-slate-100 font-medium">{parent.category_name}</td>
                                            <td className="px-4 py-3 text-right text-sky-400">{parent.planned}</td>
                                            <td className="px-4 py-3 text-right text-teal-400">{parent.actual}</td>
                                            <td
                                                className="px-4 py-3 text-right font-medium"
                                                style={remainingStyle(parent.remaining)}
                                            >
                                                {parent.remaining}
                                            </td>
                                            <td className="px-4 py-3 text-right text-slate-400">{parent.pending}</td>
                                        </tr>

                                        {/* Child rows — paddingLeft inline style MUST stay (test assertion) */}
                                        {childrenOf(parent.category_id).map(child => (
                                            <tr
                                                key={child.category_id}
                                                className="border-b border-ocean-700/50 bg-ocean-800/50 hover:bg-ocean-700/30 transition-colors"
                                            >
                                                <td
                                                    className="px-4 py-2.5 text-slate-300 text-sm"
                                                    style={{ paddingLeft: '2rem' }}
                                                >
                                                    {child.category_name}
                                                </td>
                                                <td className="px-4 py-2.5 text-right text-sky-400/80 text-sm">{child.planned}</td>
                                                <td className="px-4 py-2.5 text-right text-teal-400/80 text-sm">{child.actual}</td>
                                                <td
                                                    className="px-4 py-2.5 text-right text-sm"
                                                    style={remainingStyle(child.remaining)}
                                                >
                                                    {child.remaining}
                                                </td>
                                                <td className="px-4 py-2.5 text-right text-slate-400 text-sm">{child.pending}</td>
                                            </tr>
                                        ))}
                                    </React.Fragment>
                                ))}
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
