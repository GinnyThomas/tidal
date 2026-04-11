// components/BudgetOverrideForm.tsx
//
// Purpose: Inline grid showing all 12 month overrides for a budget.
//          Clicking a month value makes it editable. Changes are saved
//          immediately via the upsert endpoint.
//
// Props:
//   budgetId  — the budget these overrides belong to
//   overrides — current overrides from the budget response
//   defaultAmount — the budget's default monthly amount (shown when no override)
//   onChanged — called after any override is created/updated/deleted

import axios from 'axios'
import { useState } from 'react'
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

function BudgetOverrideForm({ budgetId, overrides, defaultAmount, onChanged }: Props) {
    // Track which month is being edited (null = none)
    const [editingMonth, setEditingMonth] = useState<number | null>(null)
    const [editValue, setEditValue] = useState('')

    // Build a lookup: month number → override amount
    const overrideByMonth = new Map(overrides.map(o => [o.month, o.amount]))

    const handleSave = async (month: number) => {
        const token = localStorage.getItem('access_token')
        try {
            await axios.post(
                `${getApiBaseUrl()}/api/v1/budgets/${budgetId}/overrides`,
                { month, amount: editValue },
                { headers: { Authorization: `Bearer ${token}` } }
            )
            setEditingMonth(null)
            onChanged()
        } catch {
            // Silent failure for now
        }
    }

    const handleDelete = async (month: number) => {
        const token = localStorage.getItem('access_token')
        try {
            await axios.delete(
                `${getApiBaseUrl()}/api/v1/budgets/${budgetId}/overrides/${month}`,
                { headers: { Authorization: `Bearer ${token}` } }
            )
            onChanged()
        } catch {
            // Silent failure for now
        }
    }

    return (
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
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSave(month)
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
    )
}

export default BudgetOverrideForm
