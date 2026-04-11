// components/AddReallocationForm.tsx
//
// Purpose: Inline form for creating a budget reallocation — moving planned
//          funds from one category to another within the same month.
//
// Props:
//   fromCategoryId   — the source category (pre-populated, read-only)
//   fromCategoryName — display name of the source category
//   year             — the plan year
//   month            — the plan month
//   maxAmount        — the remaining amount of the source category (used as hint)
//   onReallocationAdded — called after successful POST
//   onCancel         — called when the user cancels

import axios from 'axios'
import { useState, useEffect } from 'react'
import type { SyntheticEvent } from 'react'
import { getApiBaseUrl } from '../lib/api'

type Category = { id: string; name: string }

type Props = {
    fromCategoryId: string
    fromCategoryName: string
    year: number
    month: number
    maxAmount: string
    onReallocationAdded: () => void
    onCancel: () => void
}

function AddReallocationForm({
    fromCategoryId,
    fromCategoryName,
    year,
    month,
    maxAmount,
    onReallocationAdded,
    onCancel,
}: Props) {
    const [categories, setCategories] = useState<Category[]>([])
    const [toCategoryId, setToCategoryId] = useState('')
    const [amount, setAmount] = useState('')
    const [reason, setReason] = useState('')
    const [error, setError] = useState<string | null>(null)

    // Fetch categories for the "To" dropdown
    useEffect(() => {
        const token = localStorage.getItem('access_token')
        axios.get(`${getApiBaseUrl()}/api/v1/categories`, {
            headers: { Authorization: `Bearer ${token}` },
        }).then(res => {
            // Exclude the "from" category from the dropdown
            const filtered = res.data.filter((c: Category) => c.id !== fromCategoryId)
            setCategories(filtered)
            if (filtered.length > 0) setToCategoryId(filtered[0].id)
        }).catch(() => {})
    }, [fromCategoryId])

    const handleSubmit = async (e: SyntheticEvent) => {
        e.preventDefault()
        setError(null)
        const token = localStorage.getItem('access_token')
        try {
            await axios.post(
                `${getApiBaseUrl()}/api/v1/reallocations`,
                {
                    from_category_id: fromCategoryId,
                    to_category_id: toCategoryId,
                    amount,
                    reason,
                    year,
                    month,
                },
                { headers: { Authorization: `Bearer ${token}` } }
            )
            onReallocationAdded()
        } catch {
            setError('Could not create reallocation. Please try again.')
        }
    }

    return (
        <div className="bg-ocean-800 border border-ocean-700 rounded-xl p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-200 mb-5">Reallocate Budget</h3>

            <form onSubmit={handleSubmit} className="space-y-4">
                {/* From category — read-only */}
                <div>
                    <label className="label-base">From</label>
                    <div className="input-base bg-ocean-900/50 text-slate-300 cursor-not-allowed">
                        {fromCategoryName}
                    </div>
                </div>

                {/* To category — dropdown */}
                <div>
                    <label htmlFor="reallocTo" className="label-base">To</label>
                    <select
                        id="reallocTo"
                        value={toCategoryId}
                        onChange={(e) => setToCategoryId(e.target.value)}
                        className="input-base"
                        required
                    >
                        {categories.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                </div>

                {/* Amount */}
                <div>
                    <label htmlFor="reallocAmount" className="label-base">
                        Amount
                        {parseFloat(maxAmount) > 0 && (
                            <span className="text-slate-500 ml-2">(remaining: {maxAmount})</span>
                        )}
                    </label>
                    <input
                        id="reallocAmount"
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="input-base"
                        required
                    />
                </div>

                {/* Reason — required */}
                <div>
                    <label htmlFor="reallocReason" className="label-base">Reason</label>
                    <input
                        id="reallocReason"
                        type="text"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="input-base"
                        placeholder="e.g. Moving funds to cover Barcelona trip"
                        required
                    />
                </div>

                {error && (
                    <div className="bg-coral-500/10 border border-coral-500/30 rounded-lg px-3 py-2">
                        <p className="text-coral-400 text-sm">{error}</p>
                    </div>
                )}

                <div className="flex gap-3">
                    <button type="submit" className="btn-primary flex-1 cursor-pointer">
                        Reallocate
                    </button>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="btn-secondary flex-1 cursor-pointer"
                    >
                        Cancel
                    </button>
                </div>
            </form>
        </div>
    )
}

export default AddReallocationForm
