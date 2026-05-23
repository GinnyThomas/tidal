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
import CategoryCombobox from './CategoryCombobox'
import { getApiBaseUrl } from '../lib/api'
import { CURRENCIES } from '../lib/currencies'

type Account = { id: string; name: string }
type Category = { id: string; name: string; parent_category_id?: string | null }
type PromotionOption = { id: string; name: string }

// The subset of Transaction fields needed to pre-populate the form in edit mode.
type SplitRow = {
    categoryId: string
    amount: string
    promotionId: string
    note: string
}

export type EditingTransaction = {
    id: string
    account_id: string
    category_id: string | null
    transaction_type: string
    date: string
    payee: string | null
    amount: string
    currency: string
    status: string
    note: string | null
    parent_transaction_id: string | null
    promotion_id: string | null
    is_split?: boolean
    splits?: { category_id: string | null; promotion_id: string | null; amount: string; note: string | null }[]
}

type Props = {
    onTransactionAdded: () => void
    editingTransaction?: EditingTransaction
    onTransactionUpdated?: () => void
    // When the user is filtering by account on TransactionsPage, this
    // pre-selects that account in the dropdown for new transactions.
    defaultAccountId?: string
    // Pre-populate fields for "Add now" from a schedule.
    defaultValues?: {
        categoryId?: string
        amount?: string
        currency?: string
        payee?: string
        transactionType?: string
    }
}

function AddTransactionForm({ onTransactionAdded, editingTransaction, onTransactionUpdated, defaultAccountId, defaultValues }: Props) {
    // isEditMode drives which endpoint is called and what the heading/button say.
    const isEditMode = editingTransaction !== undefined

    const [accounts, setAccounts] = useState<Account[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [promotions, setPromotions] = useState<PromotionOption[]>([])

    // All state is initialised from editingTransaction in edit mode, or defaults in create mode.
    const [accountId, setAccountId] = useState(editingTransaction?.account_id ?? defaultAccountId ?? '')
    const [categoryId, setCategoryId] = useState(editingTransaction?.category_id ?? defaultValues?.categoryId ?? '')
    const [transactionType, setTransactionType] = useState(editingTransaction?.transaction_type ?? defaultValues?.transactionType ?? 'expense')
    const [date, setDate] = useState(editingTransaction?.date ?? new Date().toISOString().split('T')[0])
    const [payee, setPayee] = useState(editingTransaction?.payee ?? defaultValues?.payee ?? '')
    const [amount, setAmount] = useState(editingTransaction?.amount ?? defaultValues?.amount ?? '')
    const [currency, setCurrency] = useState(editingTransaction?.currency ?? defaultValues?.currency ?? 'GBP')
    const [status, setStatus] = useState(editingTransaction?.status ?? 'pending')
    const [note, setNote] = useState(editingTransaction?.note ?? '')
    const [parentTransactionId, setParentTransactionId] = useState(
        editingTransaction?.parent_transaction_id ?? ''
    )
    const [promotionId, setPromotionId] = useState(editingTransaction?.promotion_id ?? '')
    // Split transaction state
    const [isSplitMode, setIsSplitMode] = useState(editingTransaction?.is_split ?? false)
    const [splits, setSplits] = useState<SplitRow[]>(() => {
        if (editingTransaction?.is_split && editingTransaction.splits) {
            return editingTransaction.splits.map(s => ({
                categoryId: s.category_id ?? '',
                amount: s.amount,
                promotionId: s.promotion_id ?? '',
                note: s.note ?? '',
            }))
        }
        return []
    })
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
            // Category is not auto-selected — "No category" is a valid choice
            // (e.g. credit card payments). defaultValues?.categoryId pre-fills
            // when coming from "Add now" on the schedules page.
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
        // Validate splits before submitting
        if (isSplitMode && splits.length > 0) {
            const invalidSplit = splits.some(r => isNaN(parseFloat(r.amount)) || r.amount.trim() === '')
            if (invalidSplit) {
                setError('All split amounts must be valid numbers.')
                setIsSubmitting(false)
                return
            }
            const splitTotal = splits.reduce((s, r) => s + parseFloat(r.amount), 0)
            const txTotal = parseFloat(amount || '0')
            if (Math.abs(splitTotal - txTotal) > 0.005) {
                setError(`Split amounts (${splitTotal.toFixed(2)}) must equal transaction amount (${txTotal.toFixed(2)}).`)
                setIsSubmitting(false)
                return
            }
        }

        const splitPayload = isSplitMode && splits.length > 0
            ? splits.map(s => ({
                category_id: s.categoryId || null,
                promotion_id: s.promotionId || null,
                amount: s.amount,
                note: s.note || null,
            }))
            : []

        const payload = {
            account_id: accountId,
            category_id: isSplitMode ? null : (categoryId || null),
            transaction_type: transactionType,
            date,
            payee: payee || null,
            amount,
            currency,
            status,
            note: note || null,
            parent_transaction_id:
                transactionType === 'refund' && parentTransactionId
                    ? parentTransactionId
                    : null,
            promotion_id: isSplitMode ? null : (promotionId || null),
            splits: splitPayload,
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

                {!isSplitMode && (
                    <div>
                        <label htmlFor="txCategory" className="label-base">Category</label>
                        <CategoryCombobox
                            id="txCategory"
                            categories={categories}
                            value={categoryId || null}
                            onChange={(id) => setCategoryId(id ?? '')}
                            includeNoCategory={true}
                            ariaLabel="Category"
                        />
                    </div>
                )}

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

                {/* Split transaction toggle + rows */}
                <div>
                    <button
                        type="button"
                        onClick={() => {
                            const enabling = !isSplitMode
                            setIsSplitMode(enabling)
                            if (enabling) {
                                setPromotionId('')
                                if (splits.length === 0) {
                                    setSplits([{ categoryId: '', amount: '', promotionId: '', note: '' }])
                                }
                            }
                        }}
                        className={`text-xs px-3 py-1 rounded border cursor-pointer transition-colors ${
                            isSplitMode
                                ? 'bg-sky-500/20 text-sky-400 border-sky-500/30'
                                : 'border-ocean-600 text-slate-400 hover:text-slate-200'
                        }`}
                        aria-label="Split transaction"
                    >
                        {isSplitMode ? 'Cancel split' : 'Split transaction'}
                    </button>
                </div>

                {isSplitMode && (
                    <div className="space-y-2 p-3 bg-ocean-900/50 rounded-lg">
                        <div className="text-xs text-slate-400 mb-2">
                            Allocated:{' '}
                            <span className={(() => {
                                const allocated = splits.reduce((s, r) => s + parseFloat(r.amount || '0'), 0)
                                const total = parseFloat(amount || '0')
                                if (Math.abs(allocated - total) < 0.005) return 'text-teal-400'
                                return 'text-coral-400'
                            })()}>
                                {splits.reduce((s, r) => s + parseFloat(r.amount || '0'), 0).toFixed(2)}
                            </span>
                            {' '}of {parseFloat(amount || '0').toFixed(2)}
                        </div>
                        {splits.map((split, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                                <div className="flex-1">
                                    <CategoryCombobox
                                        id={`txSplitCategory-${idx}`}
                                        categories={categories}
                                        value={split.categoryId || null}
                                        onChange={(id) => {
                                            const next = [...splits]
                                            next[idx] = { ...next[idx], categoryId: id ?? '' }
                                            setSplits(next)
                                        }}
                                        includeNoCategory={true}
                                        ariaLabel={`Split ${idx + 1} category`}
                                    />
                                </div>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={split.amount}
                                    onChange={(e) => {
                                        const next = [...splits]
                                        next[idx] = { ...next[idx], amount: e.target.value }
                                        setSplits(next)
                                    }}
                                    className="input-base text-xs w-24"
                                    placeholder="Amount"
                                    aria-label={`Split ${idx + 1} amount`}
                                />
                                <button
                                    type="button"
                                    onClick={() => setSplits(splits.filter((_, i) => i !== idx))}
                                    className="text-slate-400 hover:text-coral-400 cursor-pointer text-sm"
                                    aria-label={`Remove split ${idx + 1}`}
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={() => setSplits([...splits, { categoryId: '', amount: '', promotionId: '', note: '' }])}
                            className="text-xs text-sky-400 hover:text-sky-300 cursor-pointer"
                        >
                            + Add split
                        </button>
                    </div>
                )}

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

                {/* Link to promotion — hidden in split mode (promotions are per-split) */}
                {promotions.length > 0 && !isSplitMode && (
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
