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
// Features:
//   - Add Account button toggles AddAccountForm for creating a new account.
//   - Edit button on each card opens AddAccountForm pre-populated with that
//     account's values. On submit the form PUTs to /api/v1/accounts/{id}.
//   - Only one form (Add or Edit) is visible at a time — opening one closes
//     the other (same mutual-exclusion pattern as CategoriesPage).
//   - Account name is a <Link> to /transactions?account_id={id} — clicking
//     navigates to a pre-filtered transactions view for that account.

import axios from 'axios'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
    calculated_balance: string
    institution: string | null
    note: string | null
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
    const navigate = useNavigate()
    const [accounts, setAccounts] = useState<Account[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [showForm, setShowForm] = useState(false)
    const [editingAccount, setEditingAccount] = useState<Account | null>(null)
    const editFormRef = useRef<HTMLDivElement>(null)

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

    // --- Handlers ---

    const handleAccountAdded = () => {
        setShowForm(false)
        fetchAccounts()
    }

    const handleEditAccount = (account: Account) => {
        // Close the add form so only one form is visible at a time
        setShowForm(false)
        setEditingAccount(account)
        setTimeout(() => editFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    }

    const handleAccountUpdated = () => {
        setEditingAccount(null)
        fetchAccounts()
    }

    return (
        <Layout>
            <div className="max-w-4xl mx-auto">

                {/* Page header */}
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-slate-100">Accounts</h2>
                    <button
                        onClick={() => {
                            setShowForm((prev) => !prev)
                            // Opening the add form closes any open edit form
                            setEditingAccount(null)
                        }}
                        className="btn-primary cursor-pointer"
                    >
                        Add Account
                    </button>
                </div>

                {/* Add form — shown when "Add Account" is toggled */}
                {showForm && (
                    <div className="mb-6">
                        <AddAccountForm onAccountAdded={handleAccountAdded} />
                    </div>
                )}

                {/* Edit form — shown when an Edit button is clicked.
                    keyed on id so switching to a different account remounts with fresh state. */}
                {editingAccount && (
                    <div ref={editFormRef} className="mb-6">
                        <AddAccountForm
                            key={editingAccount.id}
                            onAccountAdded={() => {}}
                            editingAccount={editingAccount}
                            onAccountUpdated={handleAccountUpdated}
                        />
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
                                className="card-hover flex items-center justify-between cursor-pointer hover:bg-ocean-700/40 transition-colors"
                                role="link"
                                tabIndex={0}
                                onClick={() => navigate(`/transactions?account_id=${account.id}`)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault()
                                        navigate(`/transactions?account_id=${account.id}`)
                                    }
                                }}
                                aria-label={`View transactions for ${account.name}`}
                            >
                                <div>
                                    {/* Name is a link to the pre-filtered transactions view */}
                                    <Link
                                        to={`/transactions?account_id=${account.id}`}
                                        className="hover:text-sky-400 transition-colors"
                                    >
                                        <strong className="text-slate-100 text-lg block">{account.name}</strong>
                                    </Link>
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
                                <div className="flex items-center gap-3">
                                    <div className="text-right">
                                        <div>
                                            <span className="text-xs text-slate-500 block">Balance</span>
                                            <span className="text-xl font-bold text-slate-100">{account.calculated_balance}</span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleEditAccount(account) }}
                                        aria-label={`Edit ${account.name}`}
                                        className="text-xs px-2.5 py-1 rounded border border-ocean-600 text-slate-400 hover:text-slate-200 hover:border-sky-500 transition-colors cursor-pointer"
                                    >
                                        Edit
                                    </button>
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
