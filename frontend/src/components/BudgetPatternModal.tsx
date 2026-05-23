// components/BudgetPatternModal.tsx
//
// Purpose: Modal for managing a budget's monthly override pattern.
//          Replaces the inline BudgetOverrideForm with a full modal dialog.
//
// Sections:
//   1. Default monthly amount + "Apply to all" button
//   2. Preset buttons: Monthly, Quarterly, Annual, Clear all
//   3. Per-month override grid (4 columns)
//   4. Notes text input
//   5. Footer: Cancel + Save

import axios from 'axios'
import { useEffect, useRef, useState } from 'react'
import { getApiBaseUrl } from '../lib/api'

type Override = {
    id: string
    budget_id: string
    month: number
    amount: string
}

type Budget = {
    id: string
    category_id: string
    default_amount: string
    currency: string
    group: string | null
    notes?: string | null
    overrides: Override[]
}

type Props = {
    budget: Budget
    categoryName: string
    onClose: () => void
    onSaved: () => void
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function BudgetPatternModal({ budget, categoryName, onClose, onSaved }: Props) {
    const [defaultAmount, setDefaultAmount] = useState(budget.default_amount)
    const [notes, setNotes] = useState(budget.notes ?? '')
    // Month overrides: index 0 = Jan (month 1), etc.
    // null means "use default" (no override for that month)
    const [monthAmounts, setMonthAmounts] = useState<(string | null)[]>(() => {
        const arr: (string | null)[] = Array(12).fill(null)
        for (const o of budget.overrides) {
            arr[o.month - 1] = o.amount
        }
        return arr
    })
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Track initial state to detect dirty
    const [initialState] = useState(() => ({
        defaultAmount: budget.default_amount,
        notes: budget.notes ?? '',
        monthAmounts: (() => {
            const arr: (string | null)[] = Array(12).fill(null)
            for (const o of budget.overrides) {
                arr[o.month - 1] = o.amount
            }
            return arr
        })(),
    }))

    const budgetDirty =
        defaultAmount !== initialState.defaultAmount ||
        notes !== initialState.notes
    const overridesDirty =
        monthAmounts.some((v, i) => v !== initialState.monthAmounts[i])
    const isDirty = budgetDirty || overridesDirty

    // Guard against state updates after unmount (e.g. user closes modal mid-save)
    const isMountedRef = useRef(true)
    useEffect(() => {
        return () => { isMountedRef.current = false }
    }, [])

    // Close on Escape
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', handleKey)
        return () => document.removeEventListener('keydown', handleKey)
    }, [onClose])

    const setMonth = (index: number, value: string | null) => {
        setMonthAmounts(prev => {
            const next = [...prev]
            next[index] = value
            return next
        })
    }

    // --- Presets ---

    const applyToAll = () => {
        setMonthAmounts(Array(12).fill(defaultAmount))
    }

    const presetMonthly = () => {
        setMonthAmounts(Array(12).fill(defaultAmount))
    }

    const presetQuarterly = () => {
        // Mar(2), Jun(5), Sep(8), Dec(11) get the default; others get "0.00"
        setMonthAmounts(Array.from({ length: 12 }, (_, i) =>
            [2, 5, 8, 11].includes(i) ? defaultAmount : '0.00'
        ))
    }

    const presetAnnual = () => {
        // Jan gets the default; others get "0.00"
        setMonthAmounts(Array.from({ length: 12 }, (_, i) =>
            i === 0 ? defaultAmount : '0.00'
        ))
    }

    const clearAll = () => {
        setMonthAmounts(Array(12).fill(null))
    }

    // --- Save ---

    const handleSave = async () => {
        if (!isDirty || saving) return

        // Validate default amount
        if (!defaultAmount || isNaN(parseFloat(defaultAmount))) {
            setError('Default monthly amount is required.')
            return
        }

        setSaving(true)
        setError(null)
        const token = localStorage.getItem('access_token')
        const headers = { Authorization: `Bearer ${token}` }
        const base = `${getApiBaseUrl()}/api/v1/budgets/${budget.id}`

        try {
            // Only POST overrides when month amounts actually changed
            if (overridesDirty) {
                const overrideItems = monthAmounts.map((amount, i) => ({
                    month: i + 1,
                    amount,
                }))
                await axios.post(`${base}/overrides/batch`, { overrides: overrideItems }, { headers })
            }

            // Only PUT budget when default amount or notes changed
            if (budgetDirty) {
                await axios.put(base, {
                    default_amount: defaultAmount,
                    notes: notes || null,
                }, { headers })
            }

            onSaved()
        } catch {
            if (isMountedRef.current) {
                setError('Could not save changes. Please try again.')
            }
        } finally {
            if (isMountedRef.current) {
                setSaving(false)
            }
        }
    }

    return (
        // Backdrop
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label={`Monthly pattern for ${categoryName}`}
        >
            {/* Modal panel */}
            <div
                className="bg-ocean-800 border border-ocean-600 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Title bar */}
                <div className="flex items-start justify-between px-6 pt-5 pb-3 border-b border-ocean-700">
                    <div>
                        <p className="text-xs text-slate-400 uppercase tracking-wider">
                            Monthly pattern · {budget.group ?? 'General'} · {budget.currency}
                        </p>
                        <h3 className="text-lg font-bold text-slate-100 mt-0.5">{categoryName}</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-white text-xl cursor-pointer leading-none p-1"
                        aria-label="Close modal"
                    >
                        ×
                    </button>
                </div>

                {/* Body */}
                <div className="px-6 py-4 space-y-5">
                    {/* Default monthly + Apply to all */}
                    <div className="flex items-end gap-3">
                        <div className="flex-1">
                            <label htmlFor="defaultAmount" className="label-base">Default monthly</label>
                            <input
                                id="defaultAmount"
                                type="number"
                                step="0.01"
                                min="0"
                                value={defaultAmount}
                                onChange={(e) => setDefaultAmount(e.target.value)}
                                className="input-base w-full"
                                aria-label="Default monthly amount"
                            />
                        </div>
                        <button
                            onClick={applyToAll}
                            className="text-sm px-3 py-2 rounded bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 border border-sky-500/30 cursor-pointer transition-colors whitespace-nowrap"
                        >
                            Apply to all
                        </button>
                    </div>

                    {/* Presets */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-slate-500 mr-1">Presets:</span>
                        <button
                            onClick={presetMonthly}
                            className="text-xs px-3 py-1.5 rounded border border-ocean-600 text-slate-400 hover:text-sky-400 hover:border-sky-500 cursor-pointer transition-colors"
                        >
                            Monthly
                        </button>
                        <button
                            onClick={presetQuarterly}
                            className="text-xs px-3 py-1.5 rounded border border-ocean-600 text-slate-400 hover:text-sky-400 hover:border-sky-500 cursor-pointer transition-colors"
                        >
                            Quarterly
                        </button>
                        <button
                            onClick={presetAnnual}
                            className="text-xs px-3 py-1.5 rounded border border-ocean-600 text-slate-400 hover:text-sky-400 hover:border-sky-500 cursor-pointer transition-colors"
                        >
                            Annual
                        </button>
                        <div className="flex-1" />
                        <button
                            onClick={clearAll}
                            className="text-xs px-3 py-1.5 rounded border border-ocean-600 text-slate-400 hover:text-coral-400 hover:border-coral-500 cursor-pointer transition-colors flex items-center gap-1"
                            aria-label="Clear all overrides"
                        >
                            Clear all
                        </button>
                    </div>

                    {/* Per-month overrides grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                        {MONTHS.map((name, i) => (
                            <div key={name} className="space-y-1">
                                <label htmlFor={`month-${i}`} className="text-xs text-slate-400 block">{name}</label>
                                <input
                                    id={`month-${i}`}
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={monthAmounts[i] ?? ''}
                                    placeholder={defaultAmount}
                                    onChange={(e) => setMonth(i, e.target.value || null)}
                                    onFocus={(e) => e.target.select()}
                                    className="input-base w-full text-sm"
                                    aria-label={`Override for ${name}`}
                                />
                                {monthAmounts[i] !== null && (
                                    <button
                                        onClick={() => setMonth(i, null)}
                                        className="text-xs text-slate-500 hover:text-coral-400 cursor-pointer"
                                    >
                                        reset
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Notes */}
                    <div>
                        <label htmlFor="budgetNotes" className="label-base">Notes</label>
                        <input
                            id="budgetNotes"
                            type="text"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Applies to all months unless overridden"
                            className="input-base w-full"
                            aria-label="Budget notes"
                        />
                    </div>

                    {/* Error */}
                    {error && (
                        <p className="text-sm text-coral-400">{error}</p>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-ocean-700">
                    <button
                        onClick={onClose}
                        className="text-sm px-4 py-2 rounded border border-ocean-600 text-slate-400 hover:text-slate-200 hover:border-sky-500 cursor-pointer transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!isDirty || saving}
                        className="text-sm px-4 py-2 rounded bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 border border-sky-500/30 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-medium"
                    >
                        {saving ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default BudgetPatternModal
