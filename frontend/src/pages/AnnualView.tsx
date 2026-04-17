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
import { fmtCurrency, fmtAmount } from '../lib/formatting'
import { GROUP_ORDER } from '../lib/budgetGroups'
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
    group: string | null
    is_income: boolean
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

type OpeningBalance = {
    id: string
    group: string
    year: number
    opening_balance: string
    currency: string
}

export type AnnualPlan = {
    year: number
    months: MonthlyPlan[]
    opening_balances: OpeningBalance[]
}

// --- Display helpers ---

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Alias fmtAmount as fmt for shorter usage in this file.
const fmt = fmtAmount

// Non-zero planned amounts render as /schedules links with comma formatting.
function fmtPlanned(amount: string): React.ReactNode {
    const n = parseFloat(amount)
    if (n === 0) return '—'
    return <Link to="/schedules" className="hover:underline">{fmtCurrency(n)}</Link>
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
    const [showCashFlow, setShowCashFlow] = useState(true)
    // Editing state for opening balance inline edit
    const [editingOBGroup, setEditingOBGroup] = useState<string | null>(null)
    const [editingOBValue, setEditingOBValue] = useState('')
    const [error, setError] = useState<string | null>(null)
    // Budget group filter — '' means no filter
    const [filterGroup, setFilterGroup] = useState('')

    // Re-runs whenever year or group changes.
    // Cache key includes group so different filters get separate cache entries.
    useEffect(() => {
        const cacheKey = `${year}:${filterGroup}`
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
        const params: Record<string, string> = {}
        if (filterGroup) params.group = filterGroup
        axios
            .get(`${getApiBaseUrl()}/api/v1/plan/${year}`, {
                headers: { Authorization: `Bearer ${token}` },
                params,
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
    }, [year, filterGroup])

    // Save opening balance — creates or updates
    const saveOpeningBalance = async (groupName: string) => {
        const token = localStorage.getItem('access_token')
        const headers = { Authorization: `Bearer ${token}` }
        const ob = annualPlan?.opening_balances?.find(b => b.group === groupName)
        const currency = groupName === 'España' ? 'EUR' : 'GBP'

        try {
            if (ob) {
                await axios.put(`${getApiBaseUrl()}/api/v1/opening-balances/${ob.id}`,
                    { opening_balance: editingOBValue }, { headers })
            } else {
                await axios.post(`${getApiBaseUrl()}/api/v1/opening-balances`,
                    { group: groupName, year, opening_balance: editingOBValue, currency }, { headers })
            }
            // Invalidate cache and re-fetch
            annualPlanCache.clear()
            setEditingOBGroup(null)
            // Trigger re-fetch by toggling a dep — simplest: just re-run the effect
            setLoading(true)
            const params: Record<string, string> = {}
            if (filterGroup) params.group = filterGroup
            const res = await axios.get(`${getApiBaseUrl()}/api/v1/plan/${year}`, { headers, params })
            annualPlanCache.set(`${year}:${filterGroup}`, res.data)
            setAnnualPlan(res.data)
            setLoading(false)
        } catch {
            setEditingOBGroup(null)
        }
    }

    // Renders the opening balance cell content — editable inline
    const renderOBCell = (groupName: string) => {
        const ob = annualPlan?.opening_balances?.find(b => b.group === groupName)
        const amount = ob ? parseFloat(ob.opening_balance) : 0

        if (editingOBGroup === groupName) {
            return (
                <input
                    type="number"
                    step="0.01"
                    value={editingOBValue}
                    onChange={(e) => setEditingOBValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') saveOpeningBalance(groupName)
                        if (e.key === 'Escape') setEditingOBGroup(null)
                    }}
                    onBlur={() => saveOpeningBalance(groupName)}
                    className="input-base text-sm text-right w-32 px-2 py-0.5"
                    autoFocus
                />
            )
        }

        return (
            <button
                onClick={() => {
                    setEditingOBGroup(groupName)
                    setEditingOBValue(ob ? ob.opening_balance : '')
                }}
                className="group/ob inline-flex items-center gap-1 cursor-pointer hover:text-sky-400 transition-colors"
            >
                {!ob ? (
                    <span className="text-slate-500 italic">Set opening balance</span>
                ) : (
                    <span className={amount >= 0 ? 'text-teal-400' : 'text-danger'}>{fmtCurrency(amount)}</span>
                )}
                <span className="text-slate-600 opacity-0 group-hover/ob:opacity-100 transition-opacity text-xs">✏️</span>
            </button>
        )
    }

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

    type CatData = { name: string; parentId: string | null; amounts: string[]; group: string | null; isIncome: boolean }
    const catMap = new Map<string, CatData>()

    annualPlan?.months.forEach((monthPlan, monthIdx) => {
        monthPlan.rows.forEach((row) => {
            if (!catMap.has(row.category_id)) {
                catMap.set(row.category_id, {
                    name: row.category_name,
                    parentId: row.parent_category_id,
                    amounts: Array(12).fill('0.00'),
                    group: row.group ?? null,
                    isIncome: row.is_income ?? false,
                })
            }
            // Overwrite the placeholder with the actual planned amount.
            catMap.get(row.category_id)!.amounts[monthIdx] = row.planned
            // Update group if not yet set (first non-null group from any month wins)
            if (row.group && !catMap.get(row.category_id)!.group) {
                catMap.get(row.category_id)!.group = row.group
            }
        })
    })

    // Filter to categories that have at least one non-zero planned amount.
    // Categories with zero planned in every month add visual noise without value.
    //
    // Exception: also keep parent categories of any non-zero category, even
    // when the parent itself has zero amounts. Without this, a parent like
    // "Banking & Finance" (no direct spend, only children) would be excluded
    // and its children would render as orphan top-level rows instead of
    // nesting under the parent header. The backend sends synthetic parent
    // entries for exactly this purpose (plan.py Step 7b).
    const activeCats = [...catMap.entries()].filter(([id, d]) => {
        const hasOwnAmounts = d.amounts.some((a) => parseFloat(a) !== 0)
        const hasActiveChildren = [...catMap.entries()].some(
            ([, cd]) => cd.parentId === id && cd.amounts.some((a) => parseFloat(a) !== 0)
        )
        return hasOwnAmounts || hasActiveChildren
    })

    // --- Build display order: parents first, children indented below them ---
    // Same "promote orphaned children" pattern used in MonthlyPlanView:
    // if a child's parent is not in the active set, treat the child as a parent.
    const catIds = new Set(activeCats.map(([id]) => id))
    const parentCats = activeCats.filter(
        ([, d]) => d.parentId === null || !catIds.has(d.parentId)
    )
    const childrenOf = (parentId: string) =>
        activeCats.filter(([, d]) => d.parentId === parentId)

    // --- Group sections for "All" filter ---
    type AnnualEntry = [string, CatData]
    type AnnualGroupSection = { group: string; entries: { parent: AnnualEntry; children: AnnualEntry[] }[] }

    const annualGroupSections: AnnualGroupSection[] = []

    if (!filterGroup) {
        const byGroup = new Map<string, { parent: AnnualEntry; children: AnnualEntry[] }[]>()
        for (const entry of parentCats) {
            const [parentId, parentData] = entry
            const children = childrenOf(parentId)

            if (children.length === 0) {
                const g = parentData.group ?? 'General'
                if (!byGroup.has(g)) byGroup.set(g, [])
                byGroup.get(g)!.push({ parent: entry, children: [] })
            } else {
                const childrenByGroup = new Map<string, AnnualEntry[]>()
                for (const child of children) {
                    const cg = child[1].group ?? 'General'
                    if (!childrenByGroup.has(cg)) childrenByGroup.set(cg, [])
                    childrenByGroup.get(cg)!.push(child)
                }
                if (parentData.group) {
                    const matching = childrenByGroup.get(parentData.group) ?? []
                    const general = parentData.group !== 'General' ? (childrenByGroup.get('General') ?? []) : []
                    if (!byGroup.has(parentData.group)) byGroup.set(parentData.group, [])
                    byGroup.get(parentData.group)!.push({ parent: entry, children: [...matching, ...general] })
                    for (const [cg, cgChildren] of childrenByGroup) {
                        if (cg !== parentData.group && cg !== 'General') {
                            if (!byGroup.has(cg)) byGroup.set(cg, [])
                            byGroup.get(cg)!.push({ parent: entry, children: cgChildren })
                        }
                    }
                } else {
                    for (const [cg, cgChildren] of childrenByGroup) {
                        if (!byGroup.has(cg)) byGroup.set(cg, [])
                        byGroup.get(cg)!.push({ parent: entry, children: cgChildren })
                    }
                }
            }
        }
        for (const g of GROUP_ORDER) {
            const entries = byGroup.get(g)
            if (entries && entries.length > 0) annualGroupSections.push({ group: g, entries })
        }
        for (const [g, entries] of byGroup) {
            if (!(GROUP_ORDER as readonly string[]).includes(g) && entries.length > 0) annualGroupSections.push({ group: g, entries })
        }
    }
    const showAnnualGroupSections = !filterGroup && annualGroupSections.length > 1

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
            <div className="w-full px-4">

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

                {/* Budget group filter */}
                <div className="flex justify-end items-center gap-4 mb-4">
                    <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={showCashFlow}
                            onChange={(e) => setShowCashFlow(e.target.checked)}
                            className="accent-sky-500"
                        />
                        Show cash flow
                    </label>
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
                    //
                    // Vertical scrolling is also contained within this wrapper
                    // (max-h-[calc(100vh-200px)]) so the <thead> can use
                    // `sticky top-0` to remain visible as the user scrolls
                    // down a tall table. Sticky positioning requires the
                    // sticky element's nearest scrolling ancestor to be this
                    // overflow-auto container — putting sticky on a <tr>
                    // inside an overflow-x-only wrapper doesn't work.
                    <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-200px)] rounded-xl border border-ocean-700 bg-ocean-800">
                        <table className="w-full text-sm min-w-[900px]">
                            <thead className="sticky top-0 z-10 bg-ocean-950">
                                <tr className="border-b border-ocean-700 bg-ocean-950">
                                    <th className="text-left px-4 py-3 text-slate-400 font-medium sticky left-0 z-20 bg-ocean-950">Category</th>
                                    {MONTH_ABBR.map((m) => (
                                        <th key={m} className="text-right px-3 py-3 text-sky-400 font-medium">{m}</th>
                                    ))}
                                    <th className="text-right px-4 py-3 text-teal-400 font-medium">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {showAnnualGroupSections ? (
                                    annualGroupSections.map(({ group: sectionGroup, entries }) => {
                                        // Cash flow: opening balance → closing balance per month
                                        const allRows = entries.flatMap(({ parent, children }) => [parent, ...children])
                                        const ob = annualPlan?.opening_balances?.find(b => b.group === sectionGroup)
                                        const openingAmount = ob ? parseFloat(ob.opening_balance) : 0

                                        // Compute monthly income and expense totals using is_income flag
                                        const monthlyIncome = Array.from({ length: 12 }, (_, i) =>
                                            allRows.filter(([, d]) => d.isIncome)
                                                .reduce((s, [, d]) => s + parseFloat(d.amounts[i]), 0)
                                        )
                                        const monthlyExpense = Array.from({ length: 12 }, (_, i) =>
                                            allRows.filter(([, d]) => !d.isIncome)
                                                .reduce((s, [, d]) => s + parseFloat(d.amounts[i]), 0)
                                        )

                                        // Closing balance: running balance across months
                                        const closingBalances: number[] = []
                                        let running = openingAmount
                                        for (let i = 0; i < 12; i++) {
                                            running = running + monthlyIncome[i] - monthlyExpense[i]
                                            closingBalances.push(running)
                                        }

                                        return (
                                            <React.Fragment key={sectionGroup}>
                                                {/* Group header */}
                                                <tr className="bg-ocean-950/60">
                                                    <td colSpan={14} className="px-4 py-2 text-slate-500 text-xs font-semibold tracking-wider uppercase sticky left-0 z-[5] bg-ocean-950">
                                                        ── {sectionGroup} ──
                                                    </td>
                                                </tr>

                                                {/* Cash flow: Opening Balance row — clickable to edit */}
                                                {showCashFlow && (
                                                    <tr className="bg-ocean-900/40 border-b border-ocean-700/30">
                                                        <td className="px-4 py-2 text-slate-400 text-sm italic sticky left-0 z-[5] bg-ocean-900">Opening Balance</td>
                                                        <td colSpan={12} className="px-3 py-2 text-right text-sm">
                                                            {renderOBCell(sectionGroup)}
                                                        </td>
                                                        <td className="px-4 py-2"></td>
                                                    </tr>
                                                )}
                                                {/* Expense rows first, then income rows */}
                                                {(() => {
                                                    const expenseEntries = entries.filter(({ parent: [, d] }) => !d.isIncome)
                                                    const incomeEntries = entries.filter(({ parent: [, d] }) => d.isIncome)

                                                    // Per-month subtotals for each sub-section
                                                    const expenseRows = expenseEntries.flatMap(({ parent, children }) => [parent, ...children])
                                                    const expenseMonthTotals = Array.from({ length: 12 }, (_, i) =>
                                                        expenseRows.reduce((s, [, d]) => s + parseFloat(d.amounts[i]), 0).toFixed(2)
                                                    )
                                                    const expenseTotal = sumAmounts(expenseMonthTotals)

                                                    const incomeRows = incomeEntries.flatMap(({ parent, children }) => [parent, ...children])
                                                    const incomeMonthTotals = Array.from({ length: 12 }, (_, i) =>
                                                        incomeRows.reduce((s, [, d]) => s + parseFloat(d.amounts[i]), 0).toFixed(2)
                                                    )
                                                    const incomeTotal = sumAmounts(incomeMonthTotals)

                                                    const renderEntry = ({ parent: [parentId, parentData], children }: { parent: AnnualEntry; children: AnnualEntry[] }) => {
                                                        const parentTotal = sumAmounts(parentData.amounts)
                                                        return (
                                                            <React.Fragment key={`${parentId}-${sectionGroup}`}>
                                                                <tr className="border-b border-ocean-700 hover:bg-ocean-700/40 transition-colors">
                                                                    <td className="px-4 py-3 text-slate-100 font-medium sticky left-0 z-[5] bg-ocean-900">{parentData.name}</td>
                                                                    {parentData.amounts.map((a, i) => (
                                                                        <td key={i} className="px-3 py-3 text-right text-sky-400">{fmtPlanned(a)}</td>
                                                                    ))}
                                                                    <td className="px-4 py-3 text-right text-teal-400 font-medium">{fmtPlanned(parentTotal)}</td>
                                                                </tr>
                                                                {children.map(([childId, childData]) => {
                                                                    const childTotal = sumAmounts(childData.amounts)
                                                                    return (
                                                                        <tr key={childId} className="border-b border-ocean-700/50 bg-ocean-800/50 hover:bg-ocean-700/30 transition-colors">
                                                                            <td className="py-2.5 pl-8 pr-4 text-slate-300 text-sm border-l-2 border-teal-500 ml-4 sticky left-0 z-[5] bg-ocean-800">{childData.name}</td>
                                                                            {childData.amounts.map((a, i) => (
                                                                                <td key={i} className="px-3 py-2.5 text-right text-sky-400/80 text-sm">{fmtPlanned(a)}</td>
                                                                            ))}
                                                                            <td className="px-4 py-2.5 text-right text-teal-400/80 text-sm">{fmtPlanned(childTotal)}</td>
                                                                        </tr>
                                                                    )
                                                                })}
                                                            </React.Fragment>
                                                        )
                                                    }

                                                    return (
                                                        <>
                                                            {expenseEntries.map(renderEntry)}
                                                            {expenseEntries.length > 0 && (
                                                                <tr className="bg-ocean-700/40 border-b border-ocean-600">
                                                                    <td className="px-4 py-2.5 text-slate-300 font-semibold text-sm sticky left-0 z-[5] bg-ocean-700">── {sectionGroup} Expenses Total ──</td>
                                                                    {expenseMonthTotals.map((t, i) => (
                                                                        <td key={i} className="px-3 py-2.5 text-right text-sky-400 font-semibold text-sm">{fmt(t)}</td>
                                                                    ))}
                                                                    <td className="px-4 py-2.5 text-right text-teal-400 font-semibold text-sm">{fmt(expenseTotal)}</td>
                                                                </tr>
                                                            )}
                                                            {incomeEntries.map(renderEntry)}
                                                            {incomeEntries.length > 0 && (
                                                                <tr className="bg-ocean-700/40 border-b border-ocean-600">
                                                                    <td className="px-4 py-2.5 text-slate-300 font-semibold text-sm sticky left-0 z-[5] bg-ocean-700">── {sectionGroup} Income Total ──</td>
                                                                    {incomeMonthTotals.map((t, i) => (
                                                                        <td key={i} className="px-3 py-2.5 text-right text-sky-400 font-semibold text-sm">{fmt(t)}</td>
                                                                    ))}
                                                                    <td className="px-4 py-2.5 text-right text-teal-400 font-semibold text-sm">{fmt(incomeTotal)}</td>
                                                                </tr>
                                                            )}
                                                        </>
                                                    )
                                                })()}

                                                {/* Cash flow: Closing Balance row */}
                                                {showCashFlow && (
                                                    <tr className="bg-ocean-900/40 border-b border-ocean-600">
                                                        <td className="px-4 py-2 text-slate-400 text-sm italic sticky left-0 z-[5] bg-ocean-900">Closing Balance</td>
                                                        {closingBalances.map((bal, i) => (
                                                            <td key={i} className={`px-3 py-2 text-right text-sm font-medium ${bal >= 0 ? 'text-teal-400' : 'text-danger'}`}>
                                                                {fmtCurrency(bal)}
                                                            </td>
                                                        ))}
                                                        <td className={`px-4 py-2 text-right text-sm font-medium ${closingBalances[11] >= 0 ? 'text-teal-400' : 'text-danger'}`}>
                                                            {fmtCurrency(closingBalances[11])} → {year + 1}
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        )
                                    })
                                ) : (
                                    (() => {
                                        // Compute cash flow for the flat view (single group or filtered)
                                        const flatGroup = filterGroup || 'General'
                                        const flatOb = annualPlan?.opening_balances?.find(b => b.group === flatGroup)
                                        const flatOpening = flatOb ? parseFloat(flatOb.opening_balance) : 0
                                        const allFlatRows = activeCats
                                        const flatMonthlyIncome = Array.from({ length: 12 }, (_, i) =>
                                            allFlatRows.filter(([, d]) => d.isIncome).reduce((s, [, d]) => s + parseFloat(d.amounts[i]), 0)
                                        )
                                        const flatMonthlyExpense = Array.from({ length: 12 }, (_, i) =>
                                            allFlatRows.filter(([, d]) => !d.isIncome).reduce((s, [, d]) => s + parseFloat(d.amounts[i]), 0)
                                        )
                                        const flatClosing: number[] = []
                                        let flatRunning = flatOpening
                                        for (let i = 0; i < 12; i++) {
                                            flatRunning = flatRunning + flatMonthlyIncome[i] - flatMonthlyExpense[i]
                                            flatClosing.push(flatRunning)
                                        }

                                        return (
                                            <>
                                                {/* Cash flow: Opening Balance — clickable */}
                                                {showCashFlow && (
                                                    <tr className="bg-ocean-900/40 border-b border-ocean-700/30">
                                                        <td className="px-4 py-2 text-slate-400 text-sm italic sticky left-0 z-[5] bg-ocean-900">Opening Balance</td>
                                                        <td colSpan={12} className="px-3 py-2 text-right text-sm">
                                                            {renderOBCell(flatGroup)}
                                                        </td>
                                                        <td className="px-4 py-2"></td>
                                                    </tr>
                                                )}

                                                {parentCats.map(([parentId, parentData]) => {
                                                    const children = childrenOf(parentId)
                                                    const parentTotal = sumAmounts(parentData.amounts)
                                                    return (
                                                        <React.Fragment key={parentId}>
                                                            <tr className="border-b border-ocean-700 hover:bg-ocean-700/40 transition-colors">
                                                                <td className="px-4 py-3 text-slate-100 font-medium sticky left-0 z-[5] bg-ocean-900">{parentData.name}</td>
                                                                {parentData.amounts.map((a, i) => (
                                                                    <td key={i} className="px-3 py-3 text-right text-sky-400">{fmtPlanned(a)}</td>
                                                                ))}
                                                                <td className="px-4 py-3 text-right text-teal-400 font-medium">{fmtPlanned(parentTotal)}</td>
                                                            </tr>
                                                            {children.map(([childId, childData]) => {
                                                                const childTotal = sumAmounts(childData.amounts)
                                                                return (
                                                                    <tr key={childId} className="border-b border-ocean-700/50 bg-ocean-800/50 hover:bg-ocean-700/30 transition-colors">
                                                                        <td className="py-2.5 pl-8 pr-4 text-slate-300 text-sm border-l-2 border-teal-500 ml-4 sticky left-0 z-[5] bg-ocean-800">{childData.name}</td>
                                                                        {childData.amounts.map((a, i) => (
                                                                            <td key={i} className="px-3 py-2.5 text-right text-sky-400/80 text-sm">{fmtPlanned(a)}</td>
                                                                        ))}
                                                                        <td className="px-4 py-2.5 text-right text-teal-400/80 text-sm">{fmtPlanned(childTotal)}</td>
                                                                    </tr>
                                                                )
                                                            })}
                                                        </React.Fragment>
                                                    )
                                                })}

                                                {/* Cash flow: Closing Balance */}
                                                {showCashFlow && (
                                                    <tr className="bg-ocean-900/40 border-b border-ocean-600">
                                                        <td className="px-4 py-2 text-slate-400 text-sm italic sticky left-0 z-[5] bg-ocean-900">Closing Balance</td>
                                                        {flatClosing.map((bal, i) => (
                                                            <td key={i} className={`px-3 py-2 text-right text-sm font-medium ${bal >= 0 ? 'text-teal-400' : 'text-danger'}`}>
                                                                {fmtCurrency(bal)}
                                                            </td>
                                                        ))}
                                                        <td className={`px-4 py-2 text-right text-sm font-medium ${flatClosing[11] >= 0 ? 'text-teal-400' : 'text-danger'}`}>
                                                            {fmtCurrency(flatClosing[11])} → {year + 1}
                                                        </td>
                                                    </tr>
                                                )}
                                            </>
                                        )
                                    })()
                                )}
                            </tbody>

                            {/* Monthly totals footer — sums all categories per column */}
                            <tfoot>
                                <tr className="border-t-2 border-ocean-600 bg-ocean-950">
                                    <td className="px-4 py-3 text-slate-100 font-bold sticky left-0 z-[5] bg-ocean-950">Total</td>
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
