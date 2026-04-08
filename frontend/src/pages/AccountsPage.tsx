// pages/AccountsPage.tsx
//
// Purpose: Displays the user's accounts with ocean-themed styling.
//          Wrapped in Layout for navigation.
//
// Four render states:
//   loading  — shows "Loading..." centred
//   error    — shows error message in coral
//   empty    — shows empty state with icon
//   list     — account cards in ocean-800 with type badges
//
// The form is rendered inline (not a fixed modal) so the "Add Account"
// button remains clickable as a toggle. The form card itself provides
// the modal-like visual appearance.

import axios from 'axios'
import { useEffect, useState } from 'react'
import Layout from '../components/Layout'
import AddAccountForm from '../components/AddAccountForm'
import { getApiBaseUrl } from '../lib/api'

// TypeScript type matching AccountResponse from the backend.
// current_balance is a string because the API serialises Decimal as a string.
type Account = {
    id: string
    name: string
    account_type: string
    currency: string
    current_balance: string
    institution: string | null
    is_active: boolean
}

// Tailwind classes per account type for the badge pill.
// Fallback to a neutral ocean-700 style for any unknown type.
const BADGE: Record<string, string> = {
    checking:    'bg-sky-500/20 text-sky-400',
    savings:     'bg-teal-500/20 text-teal-400',
    credit_card: 'bg-coral-500/20 text-coral-400',
    cash:        'bg-success/20 text-success',
    mortgage:    'bg-warning/20 text-warning',
    loan:        'bg-danger/20 text-danger',
}

function AccountsPage() {
    const [accounts, setAccounts] = useState<Account[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [showForm, setShowForm] = useState(false)

    const fetchAccounts = async () => {
        const token = localStorage.getItem('access_token')
        setLoading(true)
        setError(null)
        try {
            const response = await axios.get(`${getApiBaseUrl()}/api/v1/accounts`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            setAccounts(response.data)
        } catch {
            setError('Could not load accounts. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { fetchAccounts() }, [])

    // --- Early returns for terminal states ---

    if (loading) {
        return (
            <Layout>
                <p className="text-slate-400 text-center py-20 text-lg">Loading...</p>
            </Layout>
        )
    }

    if (error) {
        return (
            <Layout>
                <p className="text-coral-400 text-center py-20">{error}</p>
            </Layout>
        )
    }

    // --- Normal render ---

    const handleAccountAdded = () => {
        setShowForm(false)
        fetchAccounts()
    }

    return (
        <Layout>
            <div className="max-w-4xl mx-auto">

                {/* Page header */}
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-slate-100">Accounts</h2>
                    <button
                        onClick={() => setShowForm((prev) => !prev)}
                        className="btn-primary cursor-pointer"
                    >
                        Add Account
                    </button>
                </div>

                {/* Inline form — rendered below the header, not as a fixed overlay,
                    so the "Add Account" toggle button remains accessible for tests. */}
                {showForm && (
                    <div className="mb-6">
                        <AddAccountForm onAccountAdded={handleAccountAdded} />
                    </div>
                )}

                {/* Account list / empty state */}
                {accounts.length === 0 ? (
                    <div className="text-center py-20">
                        <p aria-hidden="true" className="text-5xl mb-4">🏦</p>
                        <p className="text-slate-400 text-lg">No accounts yet. Add one to get started.</p>
                    </div>
                ) : (
                    <ul className="space-y-3">
                        {accounts.map((account) => (
                            <li
                                key={account.id}
                                className="card-hover flex items-center justify-between"
                            >
                                <div>
                                    <strong className="text-slate-100 text-lg block">{account.name}</strong>
                                    <div className="flex items-center gap-2 mt-1.5">
                                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${BADGE[account.account_type] ?? 'bg-ocean-700 text-slate-300'}`}>
                                            {account.account_type}
                                        </span>
                                        <span className="text-sm text-slate-400">{account.currency}</span>
                                        {account.institution && (
                                            <span className="text-sm text-slate-500">{account.institution}</span>
                                        )}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <span className="text-xl font-bold text-slate-100">{account.current_balance}</span>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </Layout>
    )
}

export default AccountsPage
