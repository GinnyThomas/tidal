// pages/SchedulesPage.tsx
//
// Purpose: The schedules list — all recurring schedule rules for the authenticated user.
//          Wrapped in Layout for navigation.
//
// Features:
//   - Fetch: accounts, categories, and schedules are loaded together on mount
//     via Promise.all. Re-fetches when refreshKey changes (after adding a schedule).
//   - List: shows name, frequency, amount/currency, next occurrence, account,
//     category, and active status for each schedule.
//   - Active toggle: clicking the active/inactive badge calls
//     PATCH /api/v1/schedules/{id}/toggle-active and updates state optimistically.
//   - Form: "Add Schedule" button opens AddScheduleForm.
//     Clicking again closes it.
//   - Re-fetch: after form submission succeeds, refreshKey increments which
//     triggers the useEffect dependency to re-run the full fetch.

import axios from 'axios'
import { useEffect, useState } from 'react'
import Layout from '../components/Layout'
import AddScheduleForm from '../components/AddScheduleForm'
import { getApiBaseUrl } from '../lib/api'

// --- TypeScript types ---

type Schedule = {
    id: string
    name: string
    account_id: string
    category_id: string
    category_name: string
    category_icon: string | null
    amount: string
    currency: string
    frequency: string
    interval: number
    day_of_month: number | null
    start_date: string
    end_date: string | null
    next_occurrence: string | null
    auto_generate: boolean
    is_active: boolean
    payee: string | null
    note: string | null
}

type Account = {
    id: string
    name: string
}

// --- Badge colour maps ---
// Active badge is a <button> (for the inline toggle).

const ACTIVE_BADGE: Record<string, string> = {
    active:   'bg-teal-500/20 text-teal-400 border border-teal-500/30',
    inactive: 'bg-slate-500/20 text-slate-400 border border-slate-500/30',
}

// =============================================================================
// Component
// =============================================================================

function SchedulesPage() {
    const [accounts, setAccounts] = useState<Account[]>([])
    const [schedules, setSchedules] = useState<Schedule[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [showAddForm, setShowAddForm] = useState(false)
    // Incrementing refreshKey re-triggers the effect without changing any filter.
    const [refreshKey, setRefreshKey] = useState(0)

    // Fetch accounts and schedules together.
    // Accounts are needed to resolve account names in the table.
    // Category names come directly from the API via category_name on each schedule.
    useEffect(() => {
        const token = localStorage.getItem('access_token')
        const headers = { Authorization: `Bearer ${token}` }
        setLoading(true)
        setError(null)

        Promise.all([
            axios.get(`${getApiBaseUrl()}/api/v1/accounts`, { headers }),
            axios.get(`${getApiBaseUrl()}/api/v1/schedules`, { headers }),
        ]).then(([accountsRes, schedulesRes]) => {
            setAccounts(accountsRes.data)
            setSchedules(schedulesRes.data)
        }).catch(() => {
            setError('Could not load schedules. Please try again.')
        }).finally(() => {
            setLoading(false)
        })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshKey])

    // Build lookup Map so each table row can resolve the account name in O(1).
    const accountById = new Map(accounts.map(a => [a.id, a.name]))

    const handleScheduleAdded = () => {
        setShowAddForm(false)
        setRefreshKey(k => k + 1)
    }

    const handleActiveToggle = async (schedule: Schedule) => {
        const token = localStorage.getItem('access_token')
        try {
            await axios.patch(
                `${getApiBaseUrl()}/api/v1/schedules/${schedule.id}/toggle-active`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            )
            // Updates local state after the request succeeds (without a full re-fetch)
            setSchedules(prev =>
                prev.map(s => s.id === schedule.id ? { ...s, is_active: !s.is_active } : s)
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
                    <h2 className="text-2xl font-bold text-slate-100">Schedules</h2>
                    <button
                        onClick={() => setShowAddForm((prev) => !prev)}
                        className="btn-primary cursor-pointer"
                    >
                        Add Schedule
                    </button>
                </div>

                {/* Inline form */}
                {showAddForm && (
                    <div className="mb-6">
                        <AddScheduleForm onScheduleAdded={handleScheduleAdded} />
                    </div>
                )}

                {/* Schedule list / empty state */}
                {schedules.length === 0 ? (
                    <div className="text-center py-20">
                        <p aria-hidden="true" className="text-5xl mb-4">🔁</p>
                        <p className="text-slate-400 text-lg">
                            No schedules yet. Add one to get started.
                        </p>
                    </div>
                ) : (
                    <div className="bg-ocean-800 border border-ocean-700 rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-ocean-700 bg-ocean-950">
                                    <th className="text-left px-4 py-3 text-slate-400 font-medium">Name</th>
                                    <th className="text-left px-4 py-3 text-slate-400 font-medium">Frequency</th>
                                    <th className="text-right px-4 py-3 text-sky-400 font-medium">Amount</th>
                                    <th className="text-left px-4 py-3 text-slate-400 font-medium">Next</th>
                                    <th className="text-left px-4 py-3 text-slate-400 font-medium">Account</th>
                                    <th className="text-left px-4 py-3 text-slate-400 font-medium">Category</th>
                                    <th className="text-center px-4 py-3 text-slate-400 font-medium">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {schedules.map((s) => (
                                    <tr
                                        key={s.id}
                                        className="border-b border-ocean-700/50 hover:bg-ocean-700/30 transition-colors"
                                    >
                                        <td className="px-4 py-3 text-slate-100 font-medium">{s.name}</td>
                                        <td className="px-4 py-3 text-slate-300">{s.frequency}</td>
                                        <td className="px-4 py-3 text-right text-sky-400 font-medium">
                                            {s.amount} {s.currency}
                                        </td>
                                        <td className="px-4 py-3 text-slate-300">
                                            {s.next_occurrence ?? <span className="text-slate-500 italic">—</span>}
                                        </td>
                                        <td className="px-4 py-3 text-slate-300">
                                            {accountById.get(s.account_id) ?? '—'}
                                        </td>
                                        <td className="px-4 py-3 text-slate-300">
                                            {s.category_icon && <span className="mr-1">{s.category_icon}</span>}
                                            {s.category_name || '—'}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {/* Button enables keyboard access and the click-to-toggle behaviour */}
                                            <button
                                                onClick={() => handleActiveToggle(s)}
                                                className={`badge cursor-pointer hover:opacity-80 transition-opacity ${
                                                    s.is_active ? ACTIVE_BADGE.active : ACTIVE_BADGE.inactive
                                                }`}
                                            >
                                                {s.is_active ? 'Active' : 'Inactive'}
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

export default SchedulesPage
