// pages/TransactionsPage.tsx
//
// Purpose: The transactions list — every transaction for the authenticated user.
//          Wrapped in Layout for navigation.
//
// Features:
//   - Fetch: accounts, categories, and transactions are loaded together on
//     mount via Promise.all. Filters re-trigger the full fetch.
//   - Filters: account dropdown (maps id → name) and status dropdown.
//   - Inline status toggle: clicking the status badge cycles
//     pending → cleared → reconciled → pending via PUT /api/v1/transactions/{id}.
//     State is updated optimistically so the badge reflects the new value
//     immediately without waiting for a re-fetch.
//   - Forms: "Add Transaction" opens AddTransactionForm (expense/income/refund).
//            "Add Transfer" opens AddTransferForm (two-account transfer).
//     Only one form is shown at a time; opening one closes the other.
//   - Re-fetch: after a form submission succeeds, refreshKey increments which
//     triggers the useEffect dependency to re-run the full fetch.

import axios from 'axios'
import { useEffect, useState } from 'react'
import Layout from '../components/Layout'
import AddTransactionForm from '../components/AddTransactionForm'
import AddTransferForm from '../components/AddTransferForm'
import { getApiBaseUrl } from '../lib/api'

// --- TypeScript types ---

type Transaction = {
    id: string
    account_id: string
    category_id: string
    date: string
    payee: string | null
    amount: string
    currency: string
    transaction_type: string
    status: string
    note: string | null
    parent_transaction_id: string | null
}

type Account = {
    id: string
    name: string
}

type Category = {
    id: string
    name: string
}

// --- Status cycle ---
// pending → cleared → reconciled → pending.
// Only cleared and reconciled count toward budget actual spend.

function nextStatus(current: string): string {
    if (current === 'pending') return 'cleared'
    if (current === 'cleared') return 'reconciled'
    return 'pending'
}

// --- Badge colour maps ---
// Status badge is a <button> (for the inline toggle).
// Type badge is a <span> (display only).

const STATUS_BADGE: Record<string, string> = {
    pending:    'bg-amber-500/20 text-amber-400 border border-amber-500/30',
    cleared:    'bg-teal-500/20 text-teal-400 border border-teal-500/30',
    reconciled: 'bg-sky-500/20 text-sky-400 border border-sky-500/30',
}

const TYPE_BADGE: Record<string, string> = {
    expense:  'bg-coral-500/20 text-coral-400',
    income:   'bg-success/20 text-success',
    transfer: 'bg-sky-500/20 text-sky-400',
    refund:   'bg-slate-500/20 text-slate-300',
}

// =============================================================================
// Component
// =============================================================================

function TransactionsPage() {
    const [accounts, setAccounts] = useState<Account[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [transactions, setTransactions] = useState<Transaction[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [filterAccountId, setFilterAccountId] = useState('')
    const [filterStatus, setFilterStatus] = useState('')
    const [showAddForm, setShowAddForm] = useState(false)
    const [showTransferForm, setShowTransferForm] = useState(false)
    // Incrementing refreshKey re-triggers the effect without changing filters.
    const [refreshKey, setRefreshKey] = useState(0)

    // Fetch accounts, categories, and transactions together.
    // Accounts and categories are needed to resolve names displayed in the table.
    // All three are re-fetched when filters change or after a form submission.
    useEffect(() => {
        const token = localStorage.getItem('access_token')
        const headers = { Authorization: `Bearer ${token}` }
        setLoading(true)
        setError(null)

        const params: Record<string, string> = {}
        if (filterAccountId) params.account_id = filterAccountId
        if (filterStatus) params.status = filterStatus

        Promise.all([
            axios.get(`${getApiBaseUrl()}/api/v1/accounts`, { headers }),
            axios.get(`${getApiBaseUrl()}/api/v1/categories`, { headers }),
            axios.get(`${getApiBaseUrl()}/api/v1/transactions`, { headers, params }),
        ]).then(([accountsRes, catsRes, txRes]) => {
            setAccounts(accountsRes.data)
            setCategories(catsRes.data)
            setTransactions(txRes.data)
        }).catch(() => {
            setError('Could not load transactions. Please try again.')
        }).finally(() => {
            setLoading(false)
        })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterAccountId, filterStatus, refreshKey])

    // Build lookup Maps so each table row can resolve names in O(1).
    const accountById = new Map(accounts.map(a => [a.id, a.name]))
    const categoryById = new Map(categories.map(c => [c.id, c.name]))

    const handleTransactionAdded = () => {
        setShowAddForm(false)
        setShowTransferForm(false)
        setRefreshKey(k => k + 1)
    }

    const handleStatusToggle = async (tx: Transaction) => {
        const next = nextStatus(tx.status)
        const token = localStorage.getItem('access_token')
        try {
            await axios.put(
                `${getApiBaseUrl()}/api/v1/transactions/${tx.id}`,
                { status: next },
                { headers: { Authorization: `Bearer ${token}` } }
            )
            // After the PUT succeeds, without requiring a full re-fetch
            setTransactions(prev =>
                prev.map(t => t.id === tx.id ? { ...t, status: next } : t)
            )
        } catch {
            // Silent failure — a future improvement could show a toast here
        }
    }

    // --- Early returns ---

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

    return (
        <Layout>
            <div className="max-w-5xl mx-auto">

                {/* Page header */}
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-slate-100">Transactions</h2>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => {
                                setShowTransferForm((prev) => !prev)
                                setShowAddForm(false)
                            }}
                            className="btn-secondary cursor-pointer"
                        >
                            Add Transfer
                        </button>
                        <button
                            onClick={() => {
                                setShowAddForm((prev) => !prev)
                                setShowTransferForm(false)
                            }}
                            className="btn-primary cursor-pointer"
                        >
                            Add Transaction
                        </button>
                    </div>
                </div>

                {/* Inline forms — only one visible at a time */}
                {showAddForm && (
                    <div className="mb-6">
                        <AddTransactionForm onTransactionAdded={handleTransactionAdded} />
                    </div>
                )}
                {showTransferForm && (
                    <div className="mb-6">
                        <AddTransferForm onTransactionAdded={handleTransactionAdded} />
                    </div>
                )}

                {/* Filter row */}
                <div className="flex flex-wrap gap-4 mb-4">
                    <div>
                        <label htmlFor="filterAccount" className="label-base">Filter by account</label>
                        <select
                            id="filterAccount"
                            value={filterAccountId}
                            onChange={(e) => setFilterAccountId(e.target.value)}
                            className="input-base"
                        >
                            <option value="">All accounts</option>
                            {accounts.map(a => (
                                <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="filterStatus" className="label-base">Filter by status</label>
                        <select
                            id="filterStatus"
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            className="input-base"
                        >
                            <option value="">All statuses</option>
                            <option value="pending">Pending</option>
                            <option value="cleared">Cleared</option>
                            <option value="reconciled">Reconciled</option>
                        </select>
                    </div>
                </div>

                {/* Transaction list / empty state */}
                {transactions.length === 0 ? (
                    <div className="text-center py-20">
                        <p aria-hidden="true" className="text-5xl mb-4">💳</p>
                        <p className="text-slate-400 text-lg">
                            No transactions yet. Add one to get started.
                        </p>
                    </div>
                ) : (
                    <div className="bg-ocean-800 border border-ocean-700 rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-ocean-700 bg-ocean-950">
                                    <th className="text-left px-4 py-3 text-slate-400 font-medium">Date</th>
                                    <th className="text-left px-4 py-3 text-slate-400 font-medium">Payee</th>
                                    <th className="text-left px-4 py-3 text-slate-400 font-medium">Category</th>
                                    <th className="text-left px-4 py-3 text-slate-400 font-medium">Account</th>
                                    <th className="text-right px-4 py-3 text-sky-400 font-medium">Amount</th>
                                    <th className="text-center px-4 py-3 text-slate-400 font-medium">Type</th>
                                    <th className="text-center px-4 py-3 text-slate-400 font-medium">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {transactions.map((tx) => (
                                    <tr
                                        key={tx.id}
                                        className="border-b border-ocean-700/50 hover:bg-ocean-700/30 transition-colors"
                                    >
                                        <td className="px-4 py-3 text-slate-300">{tx.date}</td>
                                        <td className="px-4 py-3 text-slate-100">
                                            {tx.payee ?? <span className="text-slate-500 italic">—</span>}
                                        </td>
                                        <td className="px-4 py-3 text-slate-300">
                                            {categoryById.get(tx.category_id) ?? '—'}
                                        </td>
                                        <td className="px-4 py-3 text-slate-300">
                                            {accountById.get(tx.account_id) ?? '—'}
                                        </td>
                                        <td className="px-4 py-3 text-right text-sky-400 font-medium">
                                            {tx.amount} {tx.currency}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`badge ${TYPE_BADGE[tx.transaction_type] ?? 'bg-ocean-700 text-slate-400'}`}>
                                                {tx.transaction_type}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {/* Button enables keyboard access and the click-to-cycle behaviour */}
                                            <button
                                                onClick={() => handleStatusToggle(tx)}
                                                className={`badge cursor-pointer hover:opacity-80 transition-opacity ${STATUS_BADGE[tx.status] ?? 'bg-ocean-700 text-slate-400'}`}
                                            >
                                                {tx.status}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </Layout>
    )
}

export default TransactionsPage
