// components/BudgetOverrideForm.tsx
//
// Purpose: Inline grid showing all 12 month overrides for a budget.
//          Clicking a month value makes it editable. Changes are collected
//          locally and sent to the server in a single batch request.
//
// UX features:
//   - Auto-select on focus: clicking a cell selects all text for easy replacement
//   - Keyboard navigation: Enter saves locally and moves focus to next month
//   - Unsaved changes highlighted with amber border
//   - "Save all" button sends all pending changes via the batch endpoint
//   - Set pattern: bulk-apply monthly/quarterly/annual amounts or clear all
//     (these call the batch endpoint directly)
//
// Props:
//   budgetId  — the budget these overrides belong to
//   overrides — current overrides from the budget response
//   defaultAmount — the budget's default monthly amount (shown when no override)
//   onChanged — called after any override batch is committed

import axios from 'axios'
import { useState, useRef, useEffect } from 'react'
import { getApiBaseUrl } from '../lib/api'

type Override = {
    id: string
    budget_id: string
    month: number
    amount: string
}

type Props = {
    budgetId: string
    overrides: Override[]
    defaultAmount: string
    onChanged: () => void
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

type PatternType = 'monthly' | 'quarterly' | 'annual' | 'clear' | null

function BudgetOverrideForm({ budgetId, overrides, defaultAmount, onChanged }: Props) {
    const [editingMonth, setEditingMonth] = useState<number | null>(null)
    const [editValue, setEditValue] = useState('')
    // Pending changes: month → amount string (set/update) or null (delete).
    // These are staged locally and flushed via the batch endpoint on "Save all".
    const [pendingChanges, setPendingChanges] = useState<Map<number, string | null>>(new Map())
    const [showPattern, setShowPattern] = useState<PatternType>(null)
    const [patternAmount, setPatternAmount] = useState('')
    const [patternQuarter, setPatternQuarter] = useState<number>(0)
    const [patternMonth, setPatternMonth] = useState(1)
    const [isApplying, setIsApplying] = useState(false)

    const inputRefs = useRef<(HTMLInputElement | null)[]>(Array(12).fill(null))
    const patternRef = useRef<HTMLDivElement>(null)

    const overrideByMonth = new Map(overrides.map(o => [o.month, o.amount]))

    const token = () => localStorage.getItem('access_token')
    const headers = () => ({ Authorization: `Bearer ${token()}` })
    const apiUrl = (path: string) => `${getApiBaseUrl()}/api/v1/budgets/${budgetId}${path}`

    const hasPendingChanges = pendingChanges.size > 0

    // Effective display amount for a month, considering pending changes.
    const getDisplayAmount = (month: number): string => {
        if (pendingChanges.has(month)) {
            const pending = pendingChanges.get(month)
            // null = pending delete → show the default amount
            return pending ?? defaultAmount
        }
        return overrideByMonth.get(month) ?? defaultAmount
    }

    // Whether a month has an override (server-side or pending-set).
    const hasEffectiveOverride = (month: number): boolean => {
        if (pendingChanges.has(month)) {
            return pendingChanges.get(month) !== null
        }
        return overrideByMonth.has(month)
    }

    // Save a single month's value locally (no API call).
    const handleLocalSave = (month: number, nextIndex?: number) => {
        setPendingChanges(prev => {
            const next = new Map(prev)
            next.set(month, editValue)
            return next
        })
        setEditingMonth(null)
        // Move focus to next month (Enter key navigation)
        if (nextIndex !== undefined) {
            setTimeout(() => {
                const nextMonth = (nextIndex % 12) + 1
                const nextDisplay = getDisplayAmount(nextMonth)
                setEditingMonth(nextMonth)
                setEditValue(nextDisplay)
            }, 50)
        }
    }

    // Mark a month for deletion locally (no API call).
    const handleLocalDelete = (month: number) => {
        setPendingChanges(prev => {
            const next = new Map(prev)
            next.set(month, null)
            return next
        })
    }

    // Flush all pending changes to the server via the batch endpoint.
    const batchSave = async () => {
        if (!hasPendingChanges) return
        try {
            const items = [...pendingChanges.entries()].map(([month, amount]) => ({
                month,
                amount,
            }))
            await axios.post(apiUrl('/overrides/batch'), { overrides: items }, { headers: headers() })
            setPendingChanges(new Map())
            onChanged()
        } catch { /* silent */ }
    }

    // --- Pattern application (calls batch endpoint directly) ---

    const applyMonthly = async () => {
        if (!patternAmount || isApplying) return
        setIsApplying(true)
        try {
            const items = Array.from({ length: 12 }, (_, i) => ({
                month: i + 1,
                amount: patternAmount,
            }))
            await axios.post(apiUrl('/overrides/batch'), { overrides: items }, { headers: headers() })
            setPendingChanges(new Map())
            onChanged()
            setShowPattern(null)
        } catch { /* silent */ }
        finally { setIsApplying(false) }
    }

    const applyQuarterly = async () => {
        if (!patternAmount || isApplying) return
        setIsApplying(true)
        try {
            const items = Array.from({ length: 12 }, (_, i) => {
                const m = i + 1
                if (i % 3 === patternQuarter) {
                    return { month: m, amount: patternAmount }
                }
                // Only delete months that have an override
                if (overrideByMonth.has(m)) {
                    return { month: m, amount: null as string | null }
                }
                return null
            }).filter((x): x is { month: number; amount: string | null } => x !== null)
            await axios.post(apiUrl('/overrides/batch'), { overrides: items }, { headers: headers() })
            setPendingChanges(new Map())
            onChanged()
            setShowPattern(null)
        } catch { /* silent */ }
        finally { setIsApplying(false) }
    }

    const applyAnnual = async () => {
        if (!patternAmount || isApplying) return
        setIsApplying(true)
        try {
            const items = Array.from({ length: 12 }, (_, i) => {
                const m = i + 1
                if (m === patternMonth) {
                    return { month: m, amount: patternAmount }
                }
                if (overrideByMonth.has(m)) {
                    return { month: m, amount: null as string | null }
                }
                return null
            }).filter((x): x is { month: number; amount: string | null } => x !== null)
            await axios.post(apiUrl('/overrides/batch'), { overrides: items }, { headers: headers() })
            setPendingChanges(new Map())
            onChanged()
            setShowPattern(null)
        } catch { /* silent */ }
        finally { setIsApplying(false) }
    }

    const clearAll = async () => {
        if (isApplying) return
        setIsApplying(true)
        try {
            const items = overrides.map(o => ({ month: o.month, amount: null as string | null }))
            await axios.post(apiUrl('/overrides/batch'), { overrides: items }, { headers: headers() })
            setPendingChanges(new Map())
            onChanged()
            setShowPattern(null)
        } catch { /* silent */ }
        finally { setIsApplying(false) }
    }

    // Close pattern panel on Escape or click outside
    useEffect(() => {
        if (!showPattern) return
        const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowPattern(null) }
        const handleClick = (e: MouseEvent) => {
            if (patternRef.current && !patternRef.current.contains(e.target as Node)) setShowPattern(null)
        }
        document.addEventListener('keydown', handleKey)
        document.addEventListener('mousedown', handleClick)
        return () => { document.removeEventListener('keydown', handleKey); document.removeEventListener('mousedown', handleClick) }
    }, [showPattern])

    return (
        <div className="space-y-2">
            {/* Month grid */}
            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-12 gap-2 p-3 bg-ocean-900/50 rounded-lg">
                {MONTHS.map((name, i) => {
                    const month = i + 1
                    const hasOverride = hasEffectiveOverride(month)
                    const displayAmount = getDisplayAmount(month)
                    const isEditing = editingMonth === month
                    const isPending = pendingChanges.has(month)

                    return (
                        <div key={month} className="text-center">
                            <div className="text-xs text-slate-500 mb-1">{name}</div>
                            {isEditing ? (
                                <div className="flex flex-col gap-1">
                                    <input
                                        ref={(el) => { inputRefs.current[i] = el }}
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onFocus={(e) => e.target.select()}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault()
                                                handleLocalSave(month, i + 1)
                                            }
                                            if (e.key === 'Escape') setEditingMonth(null)
                                        }}
                                        className="input-base text-xs text-center px-1 py-0.5"
                                        autoFocus
                                        aria-label={`Override amount for ${name}`}
                                    />
                                    <button
                                        onClick={() => handleLocalSave(month)}
                                        className="text-xs text-teal-400 hover:text-teal-300 cursor-pointer"
                                    >
                                        OK
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-0.5">
                                    <button
                                        onClick={() => {
                                            setEditingMonth(month)
                                            setEditValue(displayAmount)
                                        }}
                                        className={`text-sm cursor-pointer hover:text-sky-400 transition-colors rounded px-1 ${
                                            isPending
                                                ? 'ring-1 ring-amber-500/60 text-amber-400 font-medium'
                                                : hasOverride ? 'text-sky-400 font-medium' : 'text-slate-400'
                                        }`}
                                        aria-label={`${hasOverride ? 'Edit override' : 'Set override'} for ${name}`}
                                    >
                                        {displayAmount}
                                    </button>
                                    {hasOverride && (
                                        <button
                                            onClick={() => handleLocalDelete(month)}
                                            className="text-xs text-slate-500 hover:text-coral-400 cursor-pointer"
                                            aria-label={`Remove override for ${name}`}
                                        >
                                            reset
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Save all + Pattern controls */}
            <div className="flex items-center gap-2" ref={patternRef}>
                {hasPendingChanges && (
                    <button
                        onClick={batchSave}
                        className="text-xs px-3 py-1 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30 cursor-pointer font-medium"
                    >
                        Save all
                    </button>
                )}
                <button
                    onClick={() => setShowPattern(showPattern ? null : 'monthly')}
                    className="text-xs px-2 py-1 rounded border border-ocean-600 text-slate-400 hover:text-slate-200 hover:border-sky-500 transition-colors cursor-pointer"
                    aria-label="Set pattern"
                >
                    Set pattern
                </button>

                {showPattern && (
                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Pattern type selector */}
                        <div className="flex gap-1">
                            {(['monthly', 'quarterly', 'annual', 'clear'] as const).map(t => (
                                <button
                                    key={t}
                                    onClick={() => setShowPattern(t)}
                                    className={`text-xs px-2 py-1 rounded cursor-pointer transition-colors ${
                                        showPattern === t
                                            ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                                            : 'text-slate-400 hover:text-slate-200'
                                    }`}
                                >
                                    {t === 'clear' ? 'Clear all' : t.charAt(0).toUpperCase() + t.slice(1)}
                                </button>
                            ))}
                        </div>

                        {/* Pattern-specific controls */}
                        {showPattern === 'monthly' && (
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    step="0.01"
                                    value={patternAmount}
                                    onChange={(e) => setPatternAmount(e.target.value)}
                                    onFocus={(e) => e.target.select()}
                                    className="input-base text-xs w-24 px-2 py-1"
                                    placeholder="Amount"
                                    aria-label="Monthly pattern amount"
                                />
                                <button
                                    onClick={applyMonthly}
                                    disabled={isApplying || !patternAmount}
                                    className="text-xs px-2 py-1 rounded bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Apply to all months
                                </button>
                            </div>
                        )}

                        {showPattern === 'quarterly' && (
                            <div className="flex items-center gap-2 flex-wrap">
                                <input
                                    type="number"
                                    step="0.01"
                                    value={patternAmount}
                                    onChange={(e) => setPatternAmount(e.target.value)}
                                    onFocus={(e) => e.target.select()}
                                    className="input-base text-xs w-24 px-2 py-1"
                                    placeholder="Amount"
                                />
                                <div className="flex gap-1">
                                    {['Jan/Apr/Jul/Oct', 'Feb/May/Aug/Nov', 'Mar/Jun/Sep/Dec'].map((label, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => setPatternQuarter(idx)}
                                            className={`text-xs px-1.5 py-0.5 rounded cursor-pointer ${
                                                patternQuarter === idx
                                                    ? 'bg-teal-500/20 text-teal-400'
                                                    : 'text-slate-500 hover:text-slate-300'
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                <button
                                    onClick={applyQuarterly}
                                    disabled={isApplying || !patternAmount}
                                    className="text-xs px-2 py-1 rounded bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Apply quarterly
                                </button>
                            </div>
                        )}

                        {showPattern === 'annual' && (
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    step="0.01"
                                    value={patternAmount}
                                    onChange={(e) => setPatternAmount(e.target.value)}
                                    onFocus={(e) => e.target.select()}
                                    className="input-base text-xs w-24 px-2 py-1"
                                    placeholder="Amount"
                                />
                                <select
                                    value={patternMonth}
                                    onChange={(e) => setPatternMonth(parseInt(e.target.value))}
                                    className="input-base text-xs px-2 py-1"
                                >
                                    {MONTHS.map((m, i) => (
                                        <option key={i + 1} value={i + 1}>{m}</option>
                                    ))}
                                </select>
                                <button
                                    onClick={applyAnnual}
                                    disabled={isApplying || !patternAmount}
                                    className="text-xs px-2 py-1 rounded bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Apply annual
                                </button>
                            </div>
                        )}

                        {showPattern === 'clear' && (
                            <button
                                onClick={clearAll}
                                disabled={isApplying || overrides.length === 0}
                                className="text-xs px-2 py-1 rounded bg-coral-500/20 text-coral-400 hover:bg-coral-500/30 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Clear all overrides ({overrides.length})
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

export default BudgetOverrideForm
