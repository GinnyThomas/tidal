// components/AddAccountForm.tsx
//
// Purpose: Form for creating a new account.
//          Styled as an ocean-800 card — looks like a modal panel whether
//          rendered inline (AccountsPage) or standalone (tests).
//
// Props:
//   onAccountAdded — called after successful submit so the parent can
//                    re-fetch and hide this form.

import axios from 'axios'
import { useState } from 'react'
import type { SyntheticEvent } from 'react'
import { getApiBaseUrl } from '../lib/api'

type Props = {
    onAccountAdded: () => void
}

function AddAccountForm({ onAccountAdded }: Props) {
    const [name, setName] = useState('')
    const [accountType, setAccountType] = useState('checking')
    const [currency, setCurrency] = useState('GBP')
    const [currentBalance, setCurrentBalance] = useState('0')
    const [institution, setInstitution] = useState('')
    const [note, setNote] = useState('')
    const [error, setError] = useState<string | null>(null)

    const handleSubmit = async (e: SyntheticEvent) => {
        e.preventDefault()
        setError(null)
        const token = localStorage.getItem('access_token')
        try {
            await axios.post(
                `${getApiBaseUrl()}/api/v1/accounts`,
                {
                    name,
                    account_type: accountType,
                    currency,
                    current_balance: currentBalance,
                    institution: institution || null,
                    note: note || null,
                },
                { headers: { Authorization: `Bearer ${token}` } }
            )
            onAccountAdded()
        } catch {
            setError('Could not create account. Please try again.')
        }
    }

    return (
        <div className="bg-ocean-800 border border-ocean-700 rounded-xl p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-200 mb-5">New Account</h3>

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
                    <input
                        id="currency"
                        type="text"
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        className="input-base"
                    />
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
                    className="btn-primary w-full cursor-pointer"
                >
                    Save Account
                </button>
            </form>
        </div>
    )
}

export default AddAccountForm
