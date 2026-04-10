// pages/AnnualView.tsx
//
// Purpose: Annual budget view — spreadsheet-style table showing planned amounts
//          for every active category across all 12 months of a year.
//          Wrapped in Layout for navigation.
//
// How data flows:
//   Calls GET /api/v1/plan/{year} which returns an AnnualPlan: { year, months[12] }.
//   Each MonthlyPlan already has rows with planned amounts per category.
//   This component aggregates those 12 × N rows into a single table.
//
// Table structure:
//   Header row : Category | Jan | Feb | … | Dec | Total
//   Body rows  : one row per active category (parent rows first, children indented)
//   Footer row : Total | <monthly total per col> | <grand total>
//
// Display rules:
//   - Only show categories with at least one non-zero planned amount in the year.
//     Zero-activity categories are filtered out to keep the table readable.
//   - Child categories are indented (pl-8) with a teal-500 left border.
//   - Zero amounts show as "—" rather than "0.00" to reduce visual noise.
//   - Amounts shown without currency symbol — just the number (e.g. "950.00").
//   - The annual total column sums all 12 months for each category.
//   - The monthly totals footer sums all categories for each month.
//   - Bottom-right cell is the grand total (sum of all totals).
//
// Year navigation:
//   < Prev and Next > buttons decrement/increment the year state.
//   The useEffect re-runs whenever year changes, triggering a new fetch.
//   Defaults to the current calendar year.

import axios from 'axios'
import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Layout from '../components/Layout'
import { annualPlanCache } from '../lib/annualPlanCache'
import { getApiBaseUrl } from '../lib/api'

// --- TypeScript types ---

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

export type AnnualPlan = {
    year: number
    months: MonthlyPlan[]
}

// --- Display helpers ---

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Zero amounts render as "—" to avoid a wall of "0.00" cells.
function fmt(amount: string): string {
    return parseFloat(amount) === 0 ? '—' : amount
}

// Non-zero planned amounts render as /schedules links.
// TODO: update href to /schedules?category_id=xxx once schedule category
//       filtering is added — for now all planned amounts link to the full list.
function fmtPlanned(amount: string): React.ReactNode {
    if (parseFloat(amount) === 0) return '—'
    return <Link to="/schedules" className="hover:underline">{amount}</Link>
}

// Sum an array of decimal strings, return a 2-decimal-place string.
function sumAmounts(amounts: string[]): string {
    return amounts.reduce((acc, a) => acc + parseFloat(a), 0).toFixed(2)
}

// =============================================================================
// Component
// =============================================================================

function AnnualView() {
    const [year, setYear] = useState(new Date().getFullYear())
    const [annualPlan, setAnnualPlan] = useState<AnnualPlan | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Re-runs whenever year changes (< Prev / Next > navigation).
    // Checks the session cache first — if the year's plan is already cached,
    // uses it immediately without making any API calls. The backend endpoint
    // makes 12 internal calls (one per month), so caching saves significant time.
    useEffect(() => {
        const cacheKey = String(year)
        const cached = annualPlanCache.get(cacheKey)
        if (cached) {
            setAnnualPlan(cached)
            setLoading(false)
            setError(null)
            return
        }

        const token = localStorage.getItem('access_token')
        setLoading(true)
        setError(null)
        axios
            .get(`${getApiBaseUrl()}/api/v1/plan/${year}`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            .then((res) => {
                annualPlanCache.set(cacheKey, res.data)
                setAnnualPlan(res.data)
            })
            .catch(() => {
                setError('Could not load annual plan. Please try again.')
            })
            .finally(() => {
                setLoading(false)
            })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [year])

    // --- Early returns ---

    if (loading) {
        return (
            <Layout>
                <p className="text-slate-400 text-center py-20 text-lg">
                    Building your annual plan... (this may take a moment)
                </p>
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

    // --- Aggregate planned amounts per category across all 12 months ---
    //
    // catMap: category_id → { name, parentId, amounts[12] }
    // amounts[i] = planned amount for month i+1 (amounts[0] = January).
    //
    // We only show "planned" — the annual view is forward-looking budget planning.
    // Actual and pending data is available on the monthly view.

    type CatData = { name: string; parentId: string | null; amounts: string[] }
    const catMap = new Map<string, CatData>()

    annualPlan?.months.forEach((monthPlan, monthIdx) => {
        monthPlan.rows.forEach((row) => {
            if (!catMap.has(row.category_id)) {
                catMap.set(row.category_id, {
                    name: row.category_name,
                    parentId: row.parent_category_id,
                    amounts: Array(12).fill('0.00'),
                })
            }
            // Overwrite the placeholder with the actual planned amount.
            catMap.get(row.category_id)!.amounts[monthIdx] = row.planned
        })
    })

    // Filter to categories that have at least one non-zero planned amount.
    // Categories with zero planned in every month add visual noise without value.
    const activeCats = [...catMap.entries()].filter(([, data]) =>
        data.amounts.some((a) => parseFloat(a) !== 0)
    )

    // --- Build display order: parents first, children indented below them ---
    // Same "promote orphaned children" pattern used in MonthlyPlanView:
    // if a child's parent is not in the active set, treat the child as a parent.
    const catIds = new Set(activeCats.map(([id]) => id))
    const parentCats = activeCats.filter(
        ([, d]) => d.parentId === null || !catIds.has(d.parentId)
    )
    const childrenOf = (parentId: string) =>
        activeCats.filter(([, d]) => d.parentId === parentId)

    // --- Monthly totals: sum all active categories for each month column ---
    const monthTotals = Array.from({ length: 12 }, (_, i) =>
        activeCats
            .reduce((sum, [, d]) => sum + parseFloat(d.amounts[i]), 0)
            .toFixed(2)
    )
    // Grand total: sum of all monthly totals
    const grandTotal = sumAmounts(monthTotals)

    return (
        <Layout>
            <div className="max-w-7xl mx-auto">

                {/* Year navigation */}
                <div className="flex items-center justify-between mb-6">
                    <button
                        onClick={() => setYear((y) => y - 1)}
                        className="bg-ocean-800 hover:bg-ocean-700 border border-ocean-600 text-slate-300 hover:text-sky-400 px-4 py-2 rounded-lg transition-colors cursor-pointer text-sm font-medium"
                    >
                        {'< Prev'}
                    </button>
                    <h2 className="text-2xl font-bold text-slate-100">{year}</h2>
                    <button
                        onClick={() => setYear((y) => y + 1)}
                        className="bg-ocean-800 hover:bg-ocean-700 border border-ocean-600 text-slate-300 hover:text-sky-400 px-4 py-2 rounded-lg transition-colors cursor-pointer text-sm font-medium"
                    >
                        {'Next >'}
                    </button>
                </div>

                {/* Empty state — shown when no categories have any planned amounts */}
                {activeCats.length === 0 ? (
                    <div className="text-center py-20">
                        <p aria-hidden="true" className="text-5xl mb-4">📅</p>
                        <p className="text-slate-400 text-lg">
                            No scheduled amounts for {year}. Add a schedule to get started.
                        </p>
                    </div>
                ) : (

                    // Spreadsheet table — scrolls horizontally on small screens.
                    // min-w-[900px] prevents the table from collapsing before scroll kicks in.
                    <div className="overflow-x-auto rounded-xl border border-ocean-700 bg-ocean-800">
                        <table className="w-full text-sm min-w-[900px]">
                            <thead>
                                <tr className="border-b border-ocean-700 bg-ocean-950">
                                    <th className="text-left px-4 py-3 text-slate-400 font-medium">Category</th>
                                    {MONTH_ABBR.map((m) => (
                                        <th key={m} className="text-right px-3 py-3 text-sky-400 font-medium">{m}</th>
                                    ))}
                                    <th className="text-right px-4 py-3 text-teal-400 font-medium">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {parentCats.map(([parentId, parentData]) => {
                                    const children = childrenOf(parentId)
                                    const parentTotal = sumAmounts(parentData.amounts)
                                    return (
                                        // React.Fragment with key — lets us return sibling rows
                                        // (parent + children) from a single map iteration.
                                        <React.Fragment key={parentId}>
                                            {/* Parent row */}
                                            <tr className="border-b border-ocean-700 hover:bg-ocean-700/40 transition-colors">
                                                <td className="px-4 py-3 text-slate-100 font-medium">
                                                    {parentData.name}
                                                </td>
                                                {parentData.amounts.map((a, i) => (
                                                    <td key={i} className="px-3 py-3 text-right text-sky-400">
                                                        {fmtPlanned(a)}
                                                    </td>
                                                ))}
                                                <td className="px-4 py-3 text-right text-teal-400 font-medium">
                                                    {fmtPlanned(parentTotal)}
                                                </td>
                                            </tr>

                                            {/* Child rows — pl-8 indent + teal left border */}
                                            {children.map(([childId, childData]) => {
                                                const childTotal = sumAmounts(childData.amounts)
                                                return (
                                                    <tr
                                                        key={childId}
                                                        className="border-b border-ocean-700/50 bg-ocean-800/50 hover:bg-ocean-700/30 transition-colors"
                                                    >
                                                        <td className="py-2.5 pl-8 pr-4 text-slate-300 text-sm border-l-2 border-teal-500 ml-4">
                                                            {childData.name}
                                                        </td>
                                                        {childData.amounts.map((a, i) => (
                                                            <td key={i} className="px-3 py-2.5 text-right text-sky-400/80 text-sm">
                                                                {fmtPlanned(a)}
                                                            </td>
                                                        ))}
                                                        <td className="px-4 py-2.5 text-right text-teal-400/80 text-sm">
                                                            {fmtPlanned(childTotal)}
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </React.Fragment>
                                    )
                                })}
                            </tbody>

                            {/* Monthly totals footer — sums all categories per column */}
                            <tfoot>
                                <tr className="border-t-2 border-ocean-600 bg-ocean-950">
                                    <td className="px-4 py-3 text-slate-100 font-bold">Total</td>
                                    {monthTotals.map((t, i) => (
                                        <td key={i} className="px-3 py-3 text-right text-sky-400 font-bold">
                                            {fmt(t)}
                                        </td>
                                    ))}
                                    {/* Grand total: bottom-right cell */}
                                    <td className="px-4 py-3 text-right text-teal-400 font-bold">
                                        {fmt(grandTotal)}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>
        </Layout>
    )
}

export default AnnualView
