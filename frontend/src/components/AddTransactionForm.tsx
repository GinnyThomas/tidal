// components/AddTransactionForm.tsx
//
// Purpose: Form for creating a new expense, income, or refund transaction.
//          Transfers use AddTransferForm (a separate form because they need
//          two account dropdowns and submit to a different endpoint).
//
// Props:
//   onTransactionAdded — called after successful submit so the parent can
//                        re-fetch and optionally hide this form.
//
// Design decisions:
//   - Fetches accounts and categories on mount to populate the dropdowns.
//     The fetch is best-effort: empty dropdowns are better than a broken form.
//   - parent_transaction_id is only shown when type = 'refund'. A refund
//     links back to the original expense so budget calculations can net it off.
//   - transfer is intentionally excluded from the type select — use the
//     dedicated Add Transfer form which handles the two-account logic.

import axios from 'axios'
import { useState, useEffect } from 'react'
import type { SyntheticEvent } from 'react'
import { getApiBaseUrl } from '../lib/api'

type Account = { id: string; name: string }
type Category = { id: string; name: string }

type Props = {
    onTransactionAdded: () => void
}

function AddTransactionForm({ onTransactionAdded }: Props) {
    const [accounts, setAccounts] = useState<Account[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [accountId, setAccountId] = useState('')
    const [categoryId, setCategoryId] = useState('')
    const [transactionType, setTransactionType] = useState('expense')
    const [date, setDate] = useState(new Date().toISOString().split('T')[0])
    const [payee, setPayee] = useState('')
    const [amount, setAmount] = useState('')
    const [currency, setCurrency] = useState('GBP')
    const [status, setStatus] = useState('pending')
    const [note, setNote] = useState('')
    const [parentTransactionId, setParentTransactionId] = useState('')
    const [error, setError] = useState<string | null>(null)

    // Fetch accounts and categories to populate the dropdowns.
    // Both are fetched in parallel via Promise.all to minimise load time.
    // If the fetch fails, the dropdowns stay empty — the user will see an
    // error when they try to submit (backend validates account/category ownership).
    useEffect(() => {
        const token = localStorage.getItem('access_token')
        const headers = { Authorization: `Bearer ${token}` }
        Promise.all([
            axios.get(`${getApiBaseUrl()}/api/v1/accounts`, { headers }),
            axios.get(`${getApiBaseUrl()}/api/v1/categories`, { headers }),
        ]).then(([accountsRes, catsRes]) => {
            setAccounts(accountsRes.data)
            setCategories(catsRes.data)
            // Auto-select the first option so the form is valid on first render
            if (accountsRes.data.length > 0) setAccountId(accountsRes.data[0].id)
            if (catsRes.data.length > 0) setCategoryId(catsRes.data[0].id)
        }).catch(() => {
            // Best-effort — silently leave dropdowns empty
        })
    }, [])

    const handleSubmit = async (e: SyntheticEvent) => {
        e.preventDefault()
        setError(null)
        const token = localStorage.getItem('access_token')
        try {
            await axios.post(
                `${getApiBaseUrl()}/api/v1/transactions`,
                {
                    account_id: accountId,
                    category_id: categoryId,
                    transaction_type: transactionType,
                    date,
                    payee: payee || null,
                    amount,
                    currency,
                    status,
                    note: note || null,
                    // Only send parent_transaction_id for refunds, and only if filled in
                    parent_transaction_id:
                        transactionType === 'refund' && parentTransactionId
                            ? parentTransactionId
                            : null,
                },
                { headers: { Authorization: `Bearer ${token}` } }
            )
            onTransactionAdded()
        } catch {
            setError('Could not create transaction. Please try again.')
        }
    }

    return (
        <div className="bg-ocean-800 border border-ocean-700 rounded-xl p-6 shadow-xl">
            <h3 className="section-header mb-5">New Transaction</h3>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="txAccount" className="label-base">Account</label>
                    <select
                        id="txAccount"
                        value={accountId}
                        onChange={(e) => setAccountId(e.target.value)}
                        className="input-base"
                        required
                    >
                        {accounts.map((a) => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label htmlFor="txCategory" className="label-base">Category</label>
                    <select
                        id="txCategory"
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
                    {/* transfer is excluded — use AddTransferForm for that */}
                    <label htmlFor="txType" className="label-base">Type</label>
                    <select
                        id="txType"
                        value={transactionType}
                        onChange={(e) => setTransactionType(e.target.value)}
                        className="input-base"
                    >
                        <option value="expense">Expense</option>
                        <option value="income">Income</option>
                        <option value="refund">Refund</option>
                    </select>
                </div>

                <div>
                    <label htmlFor="txDate" className="label-base">Date</label>
                    <input
                        id="txDate"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="input-base"
                        required
                    />
                </div>

                <div>
                    <label htmlFor="txPayee" className="label-base">Payee (optional)</label>
                    <input
                        id="txPayee"
                        type="text"
                        value={payee}
                        onChange={(e) => setPayee(e.target.value)}
                        className="input-base"
                    />
                </div>

                <div>
                    <label htmlFor="txAmount" className="label-base">Amount</label>
                    <input
                        id="txAmount"
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
                    <label htmlFor="txCurrency" className="label-base">Currency</label>
                    <input
                        id="txCurrency"
                        type="text"
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        className="input-base"
                        maxLength={3}
                    />
                </div>

                <div>
                    <label htmlFor="txStatus" className="label-base">Status</label>
                    <select
                        id="txStatus"
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        className="input-base"
                    >
                        <option value="pending">Pending</option>
                        <option value="cleared">Cleared</option>
                        <option value="reconciled">Reconciled</option>
                    </select>
                </div>

                {/* Only shown for refunds — links back to the original expense */}
                {transactionType === 'refund' && (
                    <div>
                        <label htmlFor="txParent" className="label-base">
                            Original Transaction ID (optional)
                        </label>
                        <input
                            id="txParent"
                            type="text"
                            value={parentTransactionId}
                            onChange={(e) => setParentTransactionId(e.target.value)}
                            className="input-base"
                            placeholder="UUID of the original expense"
                        />
                    </div>
                )}

                <div>
                    <label htmlFor="txNote" className="label-base">Note (optional)</label>
                    <textarea
                        id="txNote"
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
                    Save Transaction
                </button>
            </form>
        </div>
    )
}

export default AddTransactionForm
