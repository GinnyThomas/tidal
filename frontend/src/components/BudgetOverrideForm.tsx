// components/BudgetOverrideForm.tsx
//
// Purpose: Inline grid showing all 12 month overrides for a budget.
//          Clicking a month value makes it editable. Changes are saved
//          immediately via the upsert endpoint.
//
// UX features:
//   - Auto-select on focus: clicking a cell selects all text for easy replacement
//   - Keyboard navigation: Enter saves and moves focus to next month
//   - Set pattern: bulk-apply monthly/quarterly/annual amounts or clear all
//
// Props:
//   budgetId  — the budget these overrides belong to
//   overrides — current overrides from the budget response
//   defaultAmount — the budget's default monthly amount (shown when no override)
//   onChanged — called after any override is created/updated/deleted

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
    const [showPattern, setShowPattern] = useState<PatternType>(null)
    const [patternAmount, setPatternAmount] = useState('')
    const [patternQuarter, setPatternQuarter] = useState<number>(0) // 0=Jan/Apr/Jul/Oct, 1=Feb/May/Aug/Nov, 2=Mar/Jun/Sep/Dec
    const [patternMonth, setPatternMonth] = useState(1)
    const [isApplying, setIsApplying] = useState(false)

    // Refs for keyboard navigation between month inputs
    const inputRefs = useRef<(HTMLInputElement | null)[]>(Array(12).fill(null))
    const patternRef = useRef<HTMLDivElement>(null)

    const overrideByMonth = new Map(overrides.map(o => [o.month, o.amount]))

    const token = () => localStorage.getItem('access_token')
    const headers = () => ({ Authorization: `Bearer ${token()}` })
    const apiUrl = (path: string) => `${getApiBaseUrl()}/api/v1/budgets/${budgetId}${path}`

    const handleSave = async (month: number, nextIndex?: number) => {
        try {
            await axios.post(apiUrl('/overrides'), { month, amount: editValue }, { headers: headers() })
            setEditingMonth(null)
            onChanged()
            // Move focus to next month after save
            if (nextIndex !== undefined) {
                setTimeout(() => {
                    const nextMonth = (nextIndex % 12)
                    // Open the next month for editing
                    const nextMonthNum = nextMonth + 1
                    const nextDisplay = overrideByMonth.get(nextMonthNum) ?? defaultAmount
                    setEditingMonth(nextMonthNum)
                    setEditValue(nextDisplay)
                }, 50)
            }
        } catch {
            // Silent failure
        }
    }

    const handleDelete = async (month: number) => {
        try {
            await axios.delete(apiUrl(`/overrides/${month}`), { headers: headers() })
            onChanged()
        } catch {
            // Silent failure
        }
    }

    // --- Pattern application ---

    const applyMonthly = async () => {
        if (!patternAmount || isApplying) return
        setIsApplying(true)
        try {
            for (let m = 1; m <= 12; m++) {
                await axios.post(apiUrl('/overrides'), { month: m, amount: patternAmount }, { headers: headers() })
            }
            onChanged()
            setShowPattern(null)
        } catch { /* silent */ }
        finally { setIsApplying(false) }
    }

    const applyQuarterly = async () => {
        if (!patternAmount || isApplying) return
        setIsApplying(true)
        try {
            // Set the 4 quarter months, clear the other 8
            for (let m = 1; m <= 12; m++) {
                if ((m - 1) % 3 === patternQuarter) {
                    await axios.post(apiUrl('/overrides'), { month: m, amount: patternAmount }, { headers: headers() })
                } else if (overrideByMonth.has(m)) {
                    await axios.delete(apiUrl(`/overrides/${m}`), { headers: headers() })
                }
            }
            onChanged()
            setShowPattern(null)
        } catch { /* silent */ }
        finally { setIsApplying(false) }
    }

    const applyAnnual = async () => {
        if (!patternAmount || isApplying) return
        setIsApplying(true)
        try {
            // Set only the selected month, clear the other 11
            for (let m = 1; m <= 12; m++) {
                if (m === patternMonth) {
                    await axios.post(apiUrl('/overrides'), { month: m, amount: patternAmount }, { headers: headers() })
                } else if (overrideByMonth.has(m)) {
                    await axios.delete(apiUrl(`/overrides/${m}`), { headers: headers() })
                }
            }
            onChanged()
            setShowPattern(null)
        } catch { /* silent */ }
        finally { setIsApplying(false) }
    }

    const clearAll = async () => {
        if (isApplying) return
        setIsApplying(true)
        try {
            for (const o of overrides) {
                await axios.delete(apiUrl(`/overrides/${o.month}`), { headers: headers() })
            }
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
                    const hasOverride = overrideByMonth.has(month)
                    const displayAmount = hasOverride ? overrideByMonth.get(month)! : defaultAmount
                    const isEditing = editingMonth === month

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
                                                handleSave(month, i + 1)
                                            }
                                            if (e.key === 'Escape') setEditingMonth(null)
                                        }}
                                        className="input-base text-xs text-center px-1 py-0.5"
                                        autoFocus
                                        aria-label={`Override amount for ${name}`}
                                    />
                                    <button
                                        onClick={() => handleSave(month)}
                                        className="text-xs text-teal-400 hover:text-teal-300 cursor-pointer"
                                    >
                                        Save
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-0.5">
                                    <button
                                        onClick={() => {
                                            setEditingMonth(month)
                                            setEditValue(displayAmount)
                                        }}
                                        className={`text-sm cursor-pointer hover:text-sky-400 transition-colors ${
                                            hasOverride ? 'text-sky-400 font-medium' : 'text-slate-400'
                                        }`}
                                        aria-label={`${hasOverride ? 'Edit override' : 'Set override'} for ${name}`}
                                    >
                                        {displayAmount}
                                    </button>
                                    {hasOverride && (
                                        <button
                                            onClick={() => handleDelete(month)}
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

            {/* Pattern controls */}
            <div className="flex items-center gap-2" ref={patternRef}>
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
