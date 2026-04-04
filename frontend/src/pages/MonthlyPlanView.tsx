// pages/MonthlyPlanView.tsx
//
// Purpose: The primary view — a monthly plan table showing planned vs actual
//          vs remaining vs pending spend, grouped by category.
//
// This is the core of Tidal. One screen, one month, everything visible.
//
// What it shows:
//   A table with one row per category that has any activity in the month.
//   Columns: Category Name | Planned | Actual | Remaining | Pending
//   Child categories are indented under their parent.
//   Remaining is coloured: green = under budget, red = overspent, grey = zero.
//
// Month navigation:
//   "< Prev" and "Next >" buttons change the month. Crossing a year boundary
//   is handled correctly (January − 1 → December of the previous year).
//
// Four render states: loading, error, empty (no rows), table.
//
// Data flow:
//   Fetches GET /api/v1/plan/{year}/{month} with the JWT from localStorage.
//   Re-fetches whenever year or month state changes.
//
// Why plain axios + useState instead of React Query?
//   Following the established pattern in AccountsPage and CategoriesPage.

import axios from 'axios'
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import React from 'react'
import { getApiBaseUrl } from '../lib/api'


// --- TypeScript types matching the backend MonthlyPlan response ---

type PlanRow = {
    category_id: string
    category_name: string
    parent_category_id: string | null
    planned: string    // Decimal serialised as string by the API
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

// Moves the current {year, month} forward or backward by one month.
// Handles year boundaries: Jan - 1 → Dec of previous year, Dec + 1 → Jan of next year.
function shiftMonth(year: number, month: number, delta: -1 | 1): { year: number; month: number } {
    const date = new Date(year, month - 1 + delta) // Date month is 0-indexed
    return { year: date.getFullYear(), month: date.getMonth() + 1 }
}

// Formats a {year, month} pair as "January 2026".
const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
]
function formatMonth(year: number, month: number): string {
    return `${MONTH_NAMES[month - 1]} ${year}`
}

// --- Remaining colour logic ---
//
// remaining is a string like "42.50" or "-15.00".
// We colour it to give instant visual feedback:
//   green  = positive remaining (under budget — good)
//   red    = negative remaining (overspent — attention needed)
//   grey   = zero (exactly on budget)

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
    const [month, setMonth] = useState(now.getMonth() + 1) // JS months are 0-indexed

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

    // Fetch whenever year or month changes (including on initial mount)
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

    // --- Early returns for loading and error states ---

    if (loading) {
        return <p>Loading...</p>
    }

    if (error) {
        return <p>{error}</p>
    }

    // --- Build the hierarchical display ---
    //
    // We receive a flat list of rows. To render parents with children
    // indented underneath, we:
    //   1. Find parent rows (parent_category_id === null)
    //   2. For each parent, find its children
    //   3. Interleave them in rendering order
    //
    // Rows that reference a parent not present in the list (e.g. parent has
    // no activity this month) are rendered at the top level to avoid them
    // disappearing from the view.

    const rows = plan?.rows ?? []

    // Parent rows: no parent_category_id, OR parent not present in this month's rows
    const rowIds = new Set(rows.map(r => r.category_id))
    const parentRows = rows.filter(
        r => r.parent_category_id === null || !rowIds.has(r.parent_category_id)
    )

    const childrenOf = (parentId: string) =>
        rows.filter(r => r.parent_category_id === parentId)

    // --- Totals row ---
    const totals = plan
        ? {
              planned: plan.total_planned,
              actual: plan.total_actual,
              remaining: plan.total_remaining,
              pending: plan.total_pending,
          }
        : null

    return (
        <div>
            {/* Month navigation header */}
            <div>
                <button onClick={handlePrev}>{'< Prev'}</button>
                <h2 style={{ display: 'inline', margin: '0 1rem' }}>
                    {formatMonth(year, month)}
                </h2>
                <button onClick={handleNext}>{'Next >'}</button>
            </div>

            {rows.length === 0 ? (
                // Empty state — no activity this month
                <p>No activity this month. Add a schedule or transaction to get started.</p>
            ) : (
                <table>
                    <thead>
                        <tr>
                            <th>Category</th>
                            <th>Planned</th>
                            <th>Actual</th>
                            <th>Remaining</th>
                            <th>Pending</th>
                        </tr>
                    </thead>
                    <tbody>
                        {parentRows.map(parent => (
                            <React.Fragment key={parent.category_id}>
                                {/* Parent row */}
                                <tr>
                                    <td>{parent.category_name}</td>
                                    <td>{parent.planned}</td>
                                    <td>{parent.actual}</td>
                                    <td style={remainingStyle(parent.remaining)}>
                                        {parent.remaining}
                                    </td>
                                    <td>{parent.pending}</td>
                                </tr>

                                {/* Child rows — indented via padding-left */}
                                {childrenOf(parent.category_id).map(child => (
                                    <tr key={child.category_id}>
                                        <td style={{ paddingLeft: '2rem' }}>
                                            {child.category_name}
                                        </td>
                                        <td>{child.planned}</td>
                                        <td>{child.actual}</td>
                                        <td style={remainingStyle(child.remaining)}>
                                            {child.remaining}
                                        </td>
                                        <td>{child.pending}</td>
                                    </tr>
                                ))}
                            </React.Fragment>
                        ))}
                    </tbody>

                    {/* Totals footer row */}
                    {totals && (
                        <tfoot>
                            <tr>
                                <td><strong>Total</strong></td>
                                <td><strong>{totals.planned}</strong></td>
                                <td><strong>{totals.actual}</strong></td>
                                <td style={remainingStyle(totals.remaining)}>
                                    <strong>{totals.remaining}</strong>
                                </td>
                                <td><strong>{totals.pending}</strong></td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            )}
        </div>
    )
}

export default MonthlyPlanView
