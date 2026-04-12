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
}

function AddTransferForm({ onTransactionAdded, editingTransfer, onTransferUpdated }: Props) {
    const isEditMode = editingTransfer !== undefined

    const [accounts, setAccounts] = useState<Account[]>([])
    const [fromAccountId, setFromAccountId] = useState(editingTransfer?.account_id ?? '')
    const [toAccountId, setToAccountId] = useState('')
    const [date, setDate] = useState(editingTransfer?.date ?? new Date().toISOString().split('T')[0])
    const [amount, setAmount] = useState(editingTransfer?.amount ?? '')
    const [currency, setCurrency] = useState(editingTransfer?.currency ?? 'GBP')
    const [note, setNote] = useState(editingTransfer?.note ?? '')
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const token = localStorage.getItem('access_token')
        axios.get(`${getApiBaseUrl()}/api/v1/accounts`, {
            headers: { Authorization: `Bearer ${token}` },
        }).then(res => {
            setAccounts(res.data)
            if (!isEditMode) {
                if (res.data.length > 0) setFromAccountId(res.data[0].id)
                if (res.data.length > 1) setToAccountId(res.data[1].id)
            }
            // In edit mode, find the linked "to" account from the other leg
            if (isEditMode && editingTransfer) {
                const token2 = localStorage.getItem('access_token')
                // The linked leg: if this is the parent (debit), child has parent_transaction_id = this.id
                // If this is the child (credit), it has parent_transaction_id pointing to the parent
                axios.get(`${getApiBaseUrl()}/api/v1/transactions`, {
                    headers: { Authorization: `Bearer ${token2}` },
                }).then(txRes => {
                    const allTx = txRes.data
                    let linked = null
                    if (editingTransfer.parent_transaction_id === null) {
                        // This is the parent (debit/from) — find child where parent_transaction_id = this.id
                        linked = allTx.find((t: { parent_transaction_id: string | null }) =>
                            t.parent_transaction_id === editingTransfer.id
                        )
                    } else {
                        // This is the child (credit/to) — find parent by id
                        linked = allTx.find((t: { id: string }) =>
                            t.id === editingTransfer.parent_transaction_id
                        )
                    }
                    if (linked) {
                        // The "to" account is the other leg's account
                        if (editingTransfer.parent_transaction_id === null) {
                            setToAccountId(linked.account_id)
                        } else {
                            // We're the credit leg — swap: from=linked, to=us
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
        setError(null)
        const token = localStorage.getItem('access_token')
        try {
            if (isEditMode && editingTransfer) {
                // Update both legs of the transfer
                const payload = { date, amount, currency, note: note || null }

                // Determine which leg is which
                let fromLegId = editingTransfer.id
                let toLegId: string | null = null

                const txRes = await axios.get(`${getApiBaseUrl()}/api/v1/transactions`, {
                    headers: { Authorization: `Bearer ${token}` },
                })
                const allTx = txRes.data

                if (editingTransfer.parent_transaction_id === null) {
                    // Editing the parent (from) leg
                    const child = allTx.find((t: { parent_transaction_id: string | null }) =>
                        t.parent_transaction_id === editingTransfer.id
                    )
                    toLegId = child?.id ?? null
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
                    {isEditMode ? 'Update Transfer' : 'Save Transfer'}
                </button>
            </form>
        </div>
    )
}

export default AddTransferForm
