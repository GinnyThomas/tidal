// components/AddAccountForm.tsx
//
// Purpose: Form for creating OR editing an account.
//
// Modes:
//   Create (default) — no editingAccount prop: POSTs to /api/v1/accounts.
//   Edit — editingAccount provided: PUTs to /api/v1/accounts/{id}.
//
// Props:
//   onAccountAdded   — called after a successful create (ignored in edit mode)
//   editingAccount   — (optional) pre-populates fields; switches to edit mode
//   onAccountUpdated — (optional) called after a successful edit

import axios from 'axios'
import { useState } from 'react'
import type { SyntheticEvent } from 'react'
import { getApiBaseUrl } from '../lib/api'
import { CURRENCIES } from '../lib/currencies'

// The subset of Account fields needed to pre-populate the form in edit mode.
// Matches the AccountResponse shape returned by GET /api/v1/accounts.
export type EditingAccount = {
    id: string
    name: string
    account_type: string
    currency: string
    current_balance: string
    institution: string | null
    note: string | null
}

type Props = {
    onAccountAdded: () => void
    editingAccount?: EditingAccount
    onAccountUpdated?: () => void
}

function AddAccountForm({ onAccountAdded, editingAccount, onAccountUpdated }: Props) {
    // isEditMode drives the endpoint, heading, and button text.
    const isEditMode = editingAccount !== undefined

    const [name, setName] = useState(editingAccount?.name ?? '')
    const [accountType, setAccountType] = useState(editingAccount?.account_type ?? 'checking')
    const [currency, setCurrency] = useState(editingAccount?.currency ?? 'GBP')
    const [currentBalance, setCurrentBalance] = useState(editingAccount?.current_balance ?? '0')
    const [institution, setInstitution] = useState(editingAccount?.institution ?? '')
    const [note, setNote] = useState(editingAccount?.note ?? '')
    const [error, setError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)

    const handleSubmit = async (e: SyntheticEvent) => {
        e.preventDefault()
        if (isSubmitting) return
        setIsSubmitting(true)
        setError(null)
        const token = localStorage.getItem('access_token')
        const payload = {
            name,
            account_type: accountType,
            currency,
            current_balance: currentBalance,
            institution: institution || null,
            note: note || null,
        }
        try {
            try {
                if (isEditMode) {
                    await axios.put(
                        `${getApiBaseUrl()}/api/v1/accounts/${editingAccount.id}`,
                        payload,
                        { headers: { Authorization: `Bearer ${token}` } }
                    )
                    onAccountUpdated?.()
                } else {
                    await axios.post(
                        `${getApiBaseUrl()}/api/v1/accounts`,
                        payload,
                        { headers: { Authorization: `Bearer ${token}` } }
                    )
                    onAccountAdded()
                }
            } catch {
                setError(`Could not ${isEditMode ? 'update' : 'create'} account. Please try again.`)
            }
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="bg-ocean-800 border border-ocean-700 rounded-xl p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-200 mb-5">
                {isEditMode ? 'Edit Account' : 'New Account'}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="name" className="label-base">Account Name</label>
                    <input
                        id="name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="input-base"
                        required
                    />
                </div>

                <div>
                    <label htmlFor="accountType" className="label-base">Account Type</label>
                    <select
                        id="accountType"
                        value={accountType}
                        onChange={(e) => setAccountType(e.target.value)}
                        className="input-base"
                    >
                        <option value="checking">Checking</option>
                        <option value="savings">Savings</option>
                        <option value="credit_card">Credit Card</option>
                        <option value="cash">Cash</option>
                        <option value="mortgage">Mortgage</option>
                        <option value="loan">Loan</option>
                    </select>
                </div>

                <div>
                    <label htmlFor="currency" className="label-base">Currency</label>
                    <select
                        id="currency"
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
                    <label htmlFor="currentBalance" className="label-base">Current Balance</label>
                    <input
                        id="currentBalance"
                        type="number"
                        value={currentBalance}
                        onChange={(e) => setCurrentBalance(e.target.value)}
                        className="input-base"
                        step="0.01"
                    />
                </div>

                <div>
                    <label htmlFor="institution" className="label-base">Institution (optional)</label>
                    <input
                        id="institution"
                        type="text"
                        value={institution}
                        onChange={(e) => setInstitution(e.target.value)}
                        className="input-base"
                    />
                </div>

                <div>
                    <label htmlFor="note" className="label-base">Note (optional)</label>
                    <textarea
                        id="note"
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

                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="btn-primary w-full cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isEditMode ? 'Update Account' : 'Save Account'}
                </button>
            </form>
        </div>
    )
}

export default AddAccountForm
