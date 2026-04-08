// components/AddTransferForm.tsx
//
// Purpose: Form for creating a transfer between two of the user's accounts.
//
// Why separate from AddTransactionForm?
//   A transfer requires two account dropdowns (from + to) and submits to a
//   different endpoint (POST /api/v1/transactions/transfer). The backend creates
//   two linked Transaction rows atomically — a debit on the source account and
//   a credit on the destination. Mixing this into AddTransactionForm would add
//   awkward conditional logic to both the UI and the submission handler.
//
// Props:
//   onTransactionAdded — called after successful submit.

import axios from 'axios'
import { useState, useEffect } from 'react'
import type { SyntheticEvent } from 'react'
import { getApiBaseUrl } from '../lib/api'

type Account = { id: string; name: string }
type Category = { id: string; name: string }

type Props = {
    onTransactionAdded: () => void
}

function AddTransferForm({ onTransactionAdded }: Props) {
    const [accounts, setAccounts] = useState<Account[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [fromAccountId, setFromAccountId] = useState('')
    const [toAccountId, setToAccountId] = useState('')
    const [categoryId, setCategoryId] = useState('')
    const [date, setDate] = useState(new Date().toISOString().split('T')[0])
    const [amount, setAmount] = useState('')
    const [currency, setCurrency] = useState('GBP')
    const [note, setNote] = useState('')
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const token = localStorage.getItem('access_token')
        const headers = { Authorization: `Bearer ${token}` }
        Promise.all([
            axios.get(`${getApiBaseUrl()}/api/v1/accounts`, { headers }),
            axios.get(`${getApiBaseUrl()}/api/v1/categories`, { headers }),
        ]).then(([accountsRes, catsRes]) => {
            setAccounts(accountsRes.data)
            setCategories(catsRes.data)
            // Auto-select sensible defaults: first account as source, second as destination.
            // Having them differ avoids accidentally submitting a self-transfer.
            if (accountsRes.data.length > 0) setFromAccountId(accountsRes.data[0].id)
            if (accountsRes.data.length > 1) setToAccountId(accountsRes.data[1].id)
            if (catsRes.data.length > 0) setCategoryId(catsRes.data[0].id)
        }).catch(() => {})
    }, [])

    const handleSubmit = async (e: SyntheticEvent) => {
        e.preventDefault()
        setError(null)
        const token = localStorage.getItem('access_token')
        try {
            await axios.post(
                `${getApiBaseUrl()}/api/v1/transactions/transfer`,
                {
                    from_account_id: fromAccountId,
                    to_account_id: toAccountId,
                    category_id: categoryId,
                    date,
                    amount,
                    currency,
                    note: note || null,
                },
                { headers: { Authorization: `Bearer ${token}` } }
            )
            onTransactionAdded()
        } catch {
            setError('Could not create transfer. Please try again.')
        }
    }

    return (
        <div className="bg-ocean-800 border border-ocean-700 rounded-xl p-6 shadow-xl">
            <h3 className="section-header mb-5">New Transfer</h3>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="transferFrom" className="label-base">From Account</label>
                    <select
                        id="transferFrom"
                        value={fromAccountId}
                        onChange={(e) => setFromAccountId(e.target.value)}
                        className="input-base"
                        required
                    >
                        {accounts.map((a) => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label htmlFor="transferTo" className="label-base">To Account</label>
                    <select
                        id="transferTo"
                        value={toAccountId}
                        onChange={(e) => setToAccountId(e.target.value)}
                        className="input-base"
                        required
                    >
                        {accounts.map((a) => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label htmlFor="transferCategory" className="label-base">Category</label>
                    <select
                        id="transferCategory"
                        value={categoryId}
                        onChange={(e) => setCategoryId(e.target.value)}
                        className="input-base"
                        required
                    >
                        {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label htmlFor="transferDate" className="label-base">Date</label>
                    <input
                        id="transferDate"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="input-base"
                        required
                    />
                </div>

                <div>
                    <label htmlFor="transferAmount" className="label-base">Amount</label>
                    <input
                        id="transferAmount"
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="input-base"
                        step="0.01"
                        min="0"
                        required
                    />
                </div>

                <div>
                    <label htmlFor="transferCurrency" className="label-base">Currency</label>
                    <input
                        id="transferCurrency"
                        type="text"
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        className="input-base"
                        maxLength={3}
                    />
                </div>

                <div>
                    <label htmlFor="transferNote" className="label-base">Note (optional)</label>
                    <textarea
                        id="transferNote"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        className="input-base resize-none"
                        rows={3}
                    />
                </div>

                {error && (
                    <div className="bg-coral-500/10 border border-coral-500/30 rounded-lg px-3 py-2">
                        <p className="text-coral-400 text-sm">{error}</p>
                    </div>
                )}

                <button type="submit" className="btn-primary w-full cursor-pointer">
                    Save Transfer
                </button>
            </form>
        </div>
    )
}

export default AddTransferForm
