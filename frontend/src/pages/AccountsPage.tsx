// pages/AccountsPage.tsx
//
// Purpose: Displays the user's accounts and provides the entry point for
//          creating new ones.
//
// Four render states:
//   loading  — fetch is in progress; no button, no list
//   error    — fetch failed; no button, error message shown
//   empty    — fetch succeeded but user has no accounts; button shown
//   list     — fetch succeeded and accounts exist; button + list shown
//
// Data flow:
//   1. On mount, fetchAccounts() GETs /api/v1/accounts with the JWT.
//   2. Clicking "Add Account" toggles AddAccountForm visibility.
//   3. When AddAccountForm calls onAccountAdded(), we hide the form and
//      re-call fetchAccounts() to reload the updated list.
//
// Why useEffect with empty deps (not React Query)?
//   The rest of the codebase uses plain axios + useState for data fetching.
//   React Query is in the tech stack but not yet set up. We follow the
//   established pattern here; React Query can be introduced as a refactor.

import axios from 'axios'
import { useEffect, useState } from 'react'
import AddAccountForm from '../components/AddAccountForm'


// TypeScript type matching the AccountResponse schema from the backend.
// current_balance is a string because the API serialises Decimal as a string
// (per CLAUDE.md: "Amounts as strings (not floats)").
type Account = {
    id: string
    name: string
    account_type: string
    currency: string
    current_balance: string
    institution: string | null
    is_active: boolean
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
            const response = await axios.get('http://localhost:8000/api/v1/accounts', {
                headers: { Authorization: `Bearer ${token}` },
            })
            setAccounts(response.data)
        } catch {
            setError('Could not load accounts. Please try again.')
        } finally {
            // Always clear loading, whether the request succeeded or failed.
            setLoading(false)
        }
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { fetchAccounts() }, [])
    // Why empty deps: we want to fetch exactly once on mount. fetchAccounts is
    // defined inside the component (to access state setters), so including it
    // in deps would require useCallback to avoid an infinite re-fetch loop.
    // The simple approach — empty array with the eslint suppression — is
    // clearer for a learning project.

    // --- Early returns for terminal states ---

    if (loading) {
        return <p>Loading...</p>
    }

    if (error) {
        return <p>{error}</p>
    }

    // --- Normal render: button + optional form + list or empty state ---

    const handleAccountAdded = () => {
        setShowForm(false)   // hide the form immediately
        fetchAccounts()      // re-fetch so the new account appears in the list
    }

    return (
        <div>
            <h2>Accounts</h2>

            <button onClick={() => setShowForm((prev) => !prev)}>
                Add Account
            </button>

            {showForm && (
                <AddAccountForm onAccountAdded={handleAccountAdded} />
            )}

            {accounts.length === 0 ? (
                <p>No accounts yet. Add one to get started.</p>
            ) : (
                <ul>
                    {accounts.map((account) => (
                        <li key={account.id}>
                            <strong>{account.name}</strong>
                            {' — '}
                            {account.account_type}
                            {' · '}
                            {account.currency}
                            {' · '}
                            {account.current_balance}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

export default AccountsPage
