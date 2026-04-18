// components/AddTransferForm.tsx
//
// Purpose: Form for creating or editing a transfer between two accounts.
//
// Transfers don't require a category — they simply move money between accounts.
// The backend creates two linked Transaction rows atomically.
//
// Props:
//   onTransactionAdded — called after successful submit
//   editingTransfer    — (optional) pre-populates for editing the from leg

import axios from 'axios'
import { useState, useEffect } from 'react'
import type { SyntheticEvent } from 'react'
import { getApiBaseUrl } from '../lib/api'
import { CURRENCIES } from '../lib/currencies'

type Account = { id: string; name: string }

export type EditingTransfer = {
    id: string
    account_id: string
    date: string
    amount: string
    currency: string
    note: string | null
    parent_transaction_id: string | null
}

type Props = {
    onTransactionAdded: () => void
    editingTransfer?: EditingTransfer
    onTransferUpdated?: () => void
    // When the user is filtering by account on TransactionsPage, this
    // pre-selects that account as the "from" account for new transfers.
    defaultAccountId?: string
}

function AddTransferForm({ onTransactionAdded, editingTransfer, onTransferUpdated, defaultAccountId }: Props) {
    const isEditMode = editingTransfer !== undefined

    const [accounts, setAccounts] = useState<Account[]>([])
    const [fromAccountId, setFromAccountId] = useState(editingTransfer?.account_id ?? defaultAccountId ?? '')
    const [toAccountId, setToAccountId] = useState('')
    const [date, setDate] = useState(editingTransfer?.date ?? new Date().toISOString().split('T')[0])
    const [amount, setAmount] = useState(editingTransfer?.amount ?? '')
    const [currency, setCurrency] = useState(editingTransfer?.currency ?? 'GBP')
    const [note, setNote] = useState(editingTransfer?.note ?? '')
    const [error, setError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)

    useEffect(() => {
        const token = localStorage.getItem('access_token')
        axios.get(`${getApiBaseUrl()}/api/v1/accounts`, {
            headers: { Authorization: `Bearer ${token}` },
        }).then(res => {
            setAccounts(res.data)
            if (!isEditMode) {
                if (!defaultAccountId && res.data.length > 0) setFromAccountId(res.data[0].id)
                if (res.data.length > 1) setToAccountId(res.data[1].id)
            }
            // In edit mode, find the linked leg via targeted query
            if (isEditMode && editingTransfer) {
                const headers2 = { Authorization: `Bearer ${localStorage.getItem('access_token')}` }
                let linkedPromise: Promise<{ data: { account_id: string } | { account_id: string }[] }>

                if (editingTransfer.parent_transaction_id === null) {
                    // This is the parent (debit/from) — find child by parent_transaction_id
                    linkedPromise = axios.get(
                        `${getApiBaseUrl()}/api/v1/transactions?parent_transaction_id=${editingTransfer.id}`,
                        { headers: headers2 },
                    )
                } else {
                    // This is the child (credit/to) — fetch parent directly
                    linkedPromise = axios.get(
                        `${getApiBaseUrl()}/api/v1/transactions/${editingTransfer.parent_transaction_id}`,
                        { headers: headers2 },
                    )
                }

                linkedPromise.then(linkedRes => {
                    // List endpoint returns array, get endpoint returns object
                    const linked = Array.isArray(linkedRes.data)
                        ? linkedRes.data[0]
                        : linkedRes.data
                    if (linked) {
                        if (editingTransfer.parent_transaction_id === null) {
                            setToAccountId(linked.account_id)
                        } else {
                            setFromAccountId(linked.account_id)
                            setToAccountId(editingTransfer.account_id)
                        }
                    }
                }).catch(() => {})
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
        try {
            try {
                if (isEditMode && editingTransfer) {
                    // Update both legs of the transfer
                    const payload = { date, amount, currency, note: note || null }

                    // Determine which leg is which using targeted queries
                    let fromLegId = editingTransfer.id
                    let toLegId: string | null = null

                    if (editingTransfer.parent_transaction_id === null) {
                        // Editing the parent (from) leg — find child
                        const childRes = await axios.get(
                            `${getApiBaseUrl()}/api/v1/transactions?parent_transaction_id=${editingTransfer.id}`,
                            { headers: { Authorization: `Bearer ${token}` } },
                        )
                        toLegId = childRes.data[0]?.id ?? null
                    } else {
                        // Editing the child (to) leg — swap
                        fromLegId = editingTransfer.parent_transaction_id
                        toLegId = editingTransfer.id
                    }

                    // Update from leg
                    await axios.put(
                        `${getApiBaseUrl()}/api/v1/transactions/${fromLegId}`,
                        { ...payload, account_id: fromAccountId },
                        { headers: { Authorization: `Bearer ${token}` } }
                    )
                    // Update to leg
                    if (toLegId) {
                        await axios.put(
                            `${getApiBaseUrl()}/api/v1/transactions/${toLegId}`,
                            { ...payload, account_id: toAccountId },
                            { headers: { Authorization: `Bearer ${token}` } }
                        )
                    }

                    onTransferUpdated?.()
                } else {
                    await axios.post(
                        `${getApiBaseUrl()}/api/v1/transactions/transfer`,
                        {
                            from_account_id: fromAccountId,
                            to_account_id: toAccountId,
                            date,
                            amount,
                            currency,
                            note: note || null,
                        },
                        { headers: { Authorization: `Bearer ${token}` } }
                    )
                    onTransactionAdded()
                }
            } catch {
                setError(`Could not ${isEditMode ? 'update' : 'create'} transfer. Please try again.`)
            }
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="bg-ocean-800 border border-ocean-700 rounded-xl p-6 shadow-xl">
            <h3 className="section-header mb-5">
                {isEditMode ? 'Edit Transfer' : 'New Transfer'}
            </h3>

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
                    <select
                        id="transferCurrency"
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

                <button type="submit" disabled={isSubmitting} className="btn-primary w-full cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                    {isEditMode ? 'Update Transfer' : 'Save Transfer'}
                </button>
            </form>
        </div>
    )
}

export default AddTransferForm
