// components/AddTransactionForm.tsx
//
// Purpose: Form for creating OR editing an expense, income, or refund transaction.
//          Transfers use AddTransferForm (separate form, two accounts, different endpoint).
//
// Modes:
//   Create (default) — no editingTransaction prop: POSTs to /api/v1/transactions.
//   Edit — editingTransaction provided: PUTs to /api/v1/transactions/{id}.
//
// Props:
//   onTransactionAdded   — called after a successful create (ignored in edit mode)
//   editingTransaction   — (optional) pre-populates all fields; switches to edit mode
//   onTransactionUpdated — (optional) called after a successful edit
//
// Design decisions:
//   - Fetches accounts and categories on mount to populate the dropdowns.
//     In edit mode, the dropdowns still fetch so the full option list is available;
//     auto-selection of the first option is skipped (the pre-set values are used instead).
//   - parent_transaction_id is only shown when type = 'refund'.
//   - transfer is excluded from the type select — use AddTransferForm for that.

import axios from 'axios'
import { useState, useEffect } from 'react'
import type { SyntheticEvent } from 'react'
import { sortCategoriesByName } from '../lib/categories'
import { getApiBaseUrl } from '../lib/api'
import { CURRENCIES } from '../lib/currencies'

type Account = { id: string; name: string }
type Category = { id: string; name: string }
type PromotionOption = { id: string; name: string }

// The subset of Transaction fields needed to pre-populate the form in edit mode.
export type EditingTransaction = {
    id: string
    account_id: string
    category_id: string
    transaction_type: string
    date: string
    payee: string | null
    amount: string
    currency: string
    status: string
    note: string | null
    parent_transaction_id: string | null
    promotion_id: string | null
}

type Props = {
    onTransactionAdded: () => void
    editingTransaction?: EditingTransaction
    onTransactionUpdated?: () => void
    // When the user is filtering by account on TransactionsPage, this
    // pre-selects that account in the dropdown for new transactions.
    defaultAccountId?: string
}

function AddTransactionForm({ onTransactionAdded, editingTransaction, onTransactionUpdated, defaultAccountId }: Props) {
    // isEditMode drives which endpoint is called and what the heading/button say.
    const isEditMode = editingTransaction !== undefined

    const [accounts, setAccounts] = useState<Account[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [promotions, setPromotions] = useState<PromotionOption[]>([])

    // All state is initialised from editingTransaction in edit mode, or defaults in create mode.
    const [accountId, setAccountId] = useState(editingTransaction?.account_id ?? defaultAccountId ?? '')
    const [categoryId, setCategoryId] = useState(editingTransaction?.category_id ?? '')
    const [transactionType, setTransactionType] = useState(editingTransaction?.transaction_type ?? 'expense')
    const [date, setDate] = useState(editingTransaction?.date ?? new Date().toISOString().split('T')[0])
    const [payee, setPayee] = useState(editingTransaction?.payee ?? '')
    const [amount, setAmount] = useState(editingTransaction?.amount ?? '')
    const [currency, setCurrency] = useState(editingTransaction?.currency ?? 'GBP')
    const [status, setStatus] = useState(editingTransaction?.status ?? 'pending')
    const [note, setNote] = useState(editingTransaction?.note ?? '')
    const [parentTransactionId, setParentTransactionId] = useState(
        editingTransaction?.parent_transaction_id ?? ''
    )
    const [promotionId, setPromotionId] = useState(editingTransaction?.promotion_id ?? '')
    const [error, setError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Fetch accounts and categories to populate the dropdowns.
    // In edit mode, skip auto-selection — the pre-set values from editingTransaction are used.
    useEffect(() => {
        const token = localStorage.getItem('access_token')
        const headers = { Authorization: `Bearer ${token}` }
        Promise.all([
            axios.get(`${getApiBaseUrl()}/api/v1/accounts`, { headers }),
            axios.get(`${getApiBaseUrl()}/api/v1/categories`, { headers }),
            // In edit mode, fetch all promotions (not just active) so the currently
            // linked promotion is visible even if it has been deactivated.
            axios.get(`${getApiBaseUrl()}/api/v1/promotions${isEditMode ? '' : '?active_only=true'}`, { headers }),
        ]).then(([accountsRes, catsRes, promosRes]) => {
            setAccounts(accountsRes.data)
            const sorted = sortCategoriesByName(catsRes.data as Category[])
            setCategories(sorted)
            if (promosRes) setPromotions(promosRes.data)
            // Only auto-select the first option in create mode — in edit mode the
            // values are already set from the editingTransaction prop.
            if (!isEditMode && !defaultAccountId && accountsRes.data.length > 0) setAccountId(accountsRes.data[0].id)
            if (!isEditMode && sorted.length > 0) setCategoryId(sorted[0].id)
        }).catch(() => {
            // Best-effort — silently leave dropdowns empty
        })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handleSubmit = async (e: SyntheticEvent) => {
        e.preventDefault()
        if (isSubmitting) return
        setIsSubmitting(true)
        setError(null)
        const token = localStorage.getItem('access_token')
        const payload = {
            account_id: accountId,
            category_id: categoryId,
            transaction_type: transactionType,
            date,
            payee: payee || null,
            amount,
            currency,
            status,
            note: note || null,
            // Only include parent_transaction_id for refunds, and only if filled in
            parent_transaction_id:
                transactionType === 'refund' && parentTransactionId
                    ? parentTransactionId
                    : null,
            promotion_id: promotionId || null,
        }
        try {
            try {
                if (isEditMode) {
                    await axios.put(
                        `${getApiBaseUrl()}/api/v1/transactions/${editingTransaction.id}`,
                        payload,
                        { headers: { Authorization: `Bearer ${token}` } }
                    )
                    onTransactionUpdated?.()
                } else {
                    await axios.post(
                        `${getApiBaseUrl()}/api/v1/transactions`,
                        payload,
                        { headers: { Authorization: `Bearer ${token}` } }
                    )
                    onTransactionAdded()
                }
            } catch {
                setError(`Could not ${isEditMode ? 'update' : 'create'} transaction. Please try again.`)
            }
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="bg-ocean-800 border border-ocean-700 rounded-xl p-6 shadow-xl">
            <h3 className="section-header mb-5">
                {isEditMode ? 'Edit Transaction' : 'New Transaction'}
            </h3>

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
                    <select
                        id="txCurrency"
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

                {/* Link to promotion — optional, only shown if promotions exist */}
                {promotions.length > 0 && (
                    <div>
                        <label htmlFor="txPromotion" className="label-base">Link to Promotion (optional)</label>
                        <select
                            id="txPromotion"
                            value={promotionId}
                            onChange={(e) => setPromotionId(e.target.value)}
                            className="input-base"
                        >
                            <option value="">None</option>
                            {promotions.map((p) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
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

                <button type="submit" disabled={isSubmitting} className="btn-primary w-full cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                    {isEditMode ? 'Update Transaction' : 'Save Transaction'}
                </button>
            </form>
        </div>
    )
}

export default AddTransactionForm
