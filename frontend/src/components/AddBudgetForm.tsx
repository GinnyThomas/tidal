// components/AddBudgetForm.tsx
//
// Purpose: Form for creating OR editing a budget.
//
// Modes:
//   Create (default) — POSTs to /api/v1/budgets.
//   Edit — editingBudget provided: PUTs to /api/v1/budgets/{id}.
//
// Props:
//   onBudgetSaved   — called after a successful create or edit
//   editingBudget   — (optional) pre-populates fields; switches to edit mode
//   defaultYear     — the year to default to when creating (from parent's year selector)

import axios from 'axios'
import { sortCategoriesByName, buildCategoryOptions } from '../lib/categories'
import { useState, useEffect } from 'react'
import type { SyntheticEvent } from 'react'
import { getApiBaseUrl } from '../lib/api'
import { CURRENCIES } from '../lib/currencies'

type Category = { id: string; name: string; parent_category_id?: string | null }

export type EditingBudget = {
    id: string
    category_id: string
    year: number
    default_amount: string
    currency: string
    group: string | null
    notes?: string | null
}

type Props = {
    onBudgetSaved: () => void
    editingBudget?: EditingBudget
    defaultYear?: number
}

function AddBudgetForm({ onBudgetSaved, editingBudget, defaultYear }: Props) {
    const isEditMode = editingBudget !== undefined

    const [categories, setCategories] = useState<Category[]>([])
    const [categoryId, setCategoryId] = useState(editingBudget?.category_id ?? '')
    const [year, setYear] = useState(editingBudget?.year ?? defaultYear ?? new Date().getFullYear())
    const [defaultAmount, setDefaultAmount] = useState(editingBudget?.default_amount ?? '')
    const [currency, setCurrency] = useState(editingBudget?.currency ?? 'GBP')
    const [group, setGroup] = useState(editingBudget?.group ?? '')
    const [notes, setNotes] = useState(editingBudget?.notes ?? '')
    const [error, setError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)

    useEffect(() => {
        const token = localStorage.getItem('access_token')
        axios.get(`${getApiBaseUrl()}/api/v1/categories`, {
            headers: { Authorization: `Bearer ${token}` },
        }).then(res => {
            const sorted = sortCategoriesByName(res.data as Category[])
            setCategories(sorted)
            if (!isEditMode && sorted.length > 0 && !categoryId) {
                setCategoryId(sorted[0].id)
            }
        }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handleSubmit = async (e: SyntheticEvent) => {
        e.preventDefault()
        if (isSubmitting) return
        setIsSubmitting(true)
        setError(null)
        const token = localStorage.getItem('access_token')
        const payload = {
            category_id: categoryId,
            year,
            default_amount: defaultAmount,
            currency,
            group: group || null,
            notes: notes || null,
        }
        try {
            try {
                if (isEditMode) {
                    await axios.put(
                        `${getApiBaseUrl()}/api/v1/budgets/${editingBudget.id}`,
                        { default_amount: defaultAmount, currency, group: group || null, notes: notes || null },
                        { headers: { Authorization: `Bearer ${token}` } }
                    )
                } else {
                    await axios.post(
                        `${getApiBaseUrl()}/api/v1/budgets`,
                        payload,
                        { headers: { Authorization: `Bearer ${token}` } }
                    )
                }
                onBudgetSaved()
            } catch {
                setError(`Could not ${isEditMode ? 'update' : 'create'} budget. Please try again.`)
            }
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="bg-ocean-800 border border-ocean-700 rounded-xl p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-200 mb-5">
                {isEditMode ? 'Edit Budget' : 'New Budget'}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
                {!isEditMode && (
                    <>
                        <div>
                            <label htmlFor="budgetCategory" className="label-base">Category</label>
                            <select
                                id="budgetCategory"
                                value={categoryId}
                                onChange={(e) => setCategoryId(e.target.value)}
                                className="input-base"
                                required
                            >
                                {buildCategoryOptions(categories).map((opt) => (
                                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="budgetYear" className="label-base">Year</label>
                            <input
                                id="budgetYear"
                                type="number"
                                value={year}
                                onChange={(e) => setYear(parseInt(e.target.value, 10))}
                                className="input-base"
                                required
                            />
                        </div>
                    </>
                )}

                <div>
                    <label htmlFor="budgetAmount" className="label-base">Default Monthly Amount</label>
                    <input
                        id="budgetAmount"
                        type="number"
                        step="0.01"
                        min="0"
                        value={defaultAmount}
                        onChange={(e) => setDefaultAmount(e.target.value)}
                        className="input-base"
                        required
                    />
                </div>

                <div>
                    <label htmlFor="budgetCurrency" className="label-base">Currency</label>
                    <select
                        id="budgetCurrency"
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        className="input-base"
                    >
                        {currency && !(CURRENCIES as readonly string[]).includes(currency) && (
                            <option value={currency}>{currency}</option>
                        )}
                        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>

                <div>
                    <label htmlFor="budgetGroup" className="label-base">Group</label>
                    <select
                        id="budgetGroup"
                        value={group}
                        onChange={(e) => setGroup(e.target.value)}
                        className="input-base"
                    >
                        <option value="">None</option>
                        <option value="UK">UK</option>
                        <option value="España">España</option>
                    </select>
                </div>

                <div>
                    <label htmlFor="budgetNotes" className="label-base">Notes (optional)</label>
                    <textarea
                        id="budgetNotes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="input-base"
                        rows={2}
                        placeholder="e.g. Barclaycard 0% promo payment"
                    />
                </div>

                {error && (
                    <div className="bg-coral-500/10 border border-coral-500/30 rounded-lg px-3 py-2">
                        <p className="text-coral-400 text-sm">{error}</p>
                    </div>
                )}

                <button type="submit" disabled={isSubmitting} className="btn-primary w-full cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                    {isEditMode ? 'Update Budget' : 'Save Budget'}
                </button>
            </form>
        </div>
    )
}

export default AddBudgetForm
