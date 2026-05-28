// pages/TransactionsPage.tsx
//
// Purpose: The transactions list — every transaction for the authenticated user.
//          Wrapped in Layout for navigation.
//
// Features:
//   - Fetch: accounts and transactions are fetched together (Promise.all) and
//     re-fetched whenever any filter changes.
//     Categories are fetched once on mount in a separate useEffect (empty deps)
//     so that the filter dropdown is populated without re-fetching on every
//     filter change.
//   - Date filters: quick-select buttons (This Month, Last Month, etc.) plus
//     custom date range inputs. Defaults to "This Month".
//   - Pagination: server-side via page/page_size params. Controls below table.
//   - Filters: account dropdown, category dropdown, and status dropdown.
//     Category filter also reads ?category_id from the URL on mount so
//     clicking a category link in CategoriesPage or MonthlyPlanView
//     pre-selects the filter automatically (category drill-down).
//   - Active filter badge: when a category is selected a "Filtered by: Name"
//     pill with an x clear button appears above the table. Clicking x also
//     calls setSearchParams({}) to keep the URL in sync.
//   - Inline status toggle: clicking the status badge cycles
//     pending -> cleared -> reconciled -> pending via PUT /api/v1/transactions/{id}.
//     State is updated optimistically so the badge reflects the new value
//     immediately without waiting for a re-fetch.
//   - Notes: rows with a non-null note show a note icon in the Actions column.
//     Clicking toggles an expanded row showing the note text.
//   - Forms: "Add Transaction" opens AddTransactionForm (expense/income/refund).
//            "Add Transfer" opens AddTransferForm (two-account transfer).
//     Only one form is shown at a time; opening one closes the other.
//   - Re-fetch: after a form submission succeeds, refreshKey increments which
//     triggers the useEffect dependency to re-run the full fetch.

import axios from 'axios'
import { Fragment, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Layout from '../components/Layout'
import AddTransactionForm from '../components/AddTransactionForm'
import AddTransferForm from '../components/AddTransferForm'
import TransactionTotals from '../components/TransactionTotals'
import type { Totals } from '../components/TransactionTotals'
import { annualPlanCache } from '../lib/annualPlanCache'
import { getApiBaseUrl } from '../lib/api'

// --- TypeScript types ---

type TransactionSplit = {
    id: string
    transaction_id: string
    category_id: string | null
    category_name: string | null
    promotion_id: string | null
    amount: string
    note: string | null
}

type Transaction = {
    id: string
    account_id: string
    category_id: string | null
    category_name: string | null
    category_icon: string | null
    date: string
    payee: string | null
    amount: string
    currency: string
    transaction_type: string
    status: string
    note: string | null
    parent_transaction_id: string | null
    promotion_id: string | null
    is_split: boolean
    splits: TransactionSplit[]
}

type PaginatedResponse = {
    items: Transaction[]
    total: number
    page: number
    page_size: number
    total_pages: number
    totals: Totals
}

type Account = {
    id: string
    name: string
    calculated_balance: string
    currency: string
}

type Category = {
    id: string
    name: string
    parent_category_id: string | null
}

// --- Status cycle ---
// pending -> cleared -> reconciled -> pending.
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

// --- Date range helpers ---

type DatePreset = 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'this_year' | 'custom' | 'all'

// Format a Date as YYYY-MM-DD using local date parts (avoids UTC timezone shift)
function fmtDate(d: Date): string {
    const yy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yy}-${mm}-${dd}`
}

function getDateRange(preset: DatePreset): { from: string; to: string } | null {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth() // 0-based

    switch (preset) {
        case 'this_month':
            return {
                from: `${y}-${String(m + 1).padStart(2, '0')}-01`,
                to: fmtDate(new Date(y, m + 1, 0)),
            }
        case 'last_month': {
            const lm = m === 0 ? 11 : m - 1
            const ly = m === 0 ? y - 1 : y
            return {
                from: `${ly}-${String(lm + 1).padStart(2, '0')}-01`,
                to: fmtDate(new Date(ly, lm + 1, 0)),
            }
        }
        case 'this_quarter': {
            const qStart = Math.floor(m / 3) * 3
            return {
                from: `${y}-${String(qStart + 1).padStart(2, '0')}-01`,
                to: fmtDate(new Date(y, qStart + 3, 0)),
            }
        }
        case 'last_quarter': {
            let qStart = Math.floor(m / 3) * 3 - 3
            let qy = y
            if (qStart < 0) { qStart += 12; qy -= 1 }
            return {
                from: `${qy}-${String(qStart + 1).padStart(2, '0')}-01`,
                to: fmtDate(new Date(qy, qStart + 3, 0)),
            }
        }
        case 'this_year':
            return { from: `${y}-01-01`, to: `${y}-12-31` }
        case 'all':
            return null
        case 'custom':
            return null // handled by custom inputs
    }
}

// =============================================================================
// Component
// =============================================================================

function TransactionsPage() {
    // Read ?category_id from URL on mount — powers the category drill-down:
    // clicking a category in CategoriesPage or MonthlyPlanView navigates here
    // with the filter pre-set.
    const [searchParams, setSearchParams] = useSearchParams()

    const [accounts, setAccounts] = useState<Account[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [transactions, setTransactions] = useState<Transaction[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    // Initialise from URL — '' means no filter
    const [filterAccountId, setFilterAccountId] = useState(
        () => searchParams.get('account_id') ?? ''
    )
    // Initialise from URL — '' means no filter
    const [filterCategoryId, setFilterCategoryId] = useState(
        () => searchParams.get('category_id') ?? ''
    )
    // Initialise from URL — '' means no filter
    const [filterStatus, setFilterStatus] = useState(
        () => searchParams.get('status') ?? ''
    )
    const [showAddForm, setShowAddForm] = useState(false)
    const [showTransferForm, setShowTransferForm] = useState(false)
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
    const [editingTransfer, setEditingTransfer] = useState<Transaction | null>(null)
    const editFormRef = useRef<HTMLDivElement>(null)
    // Incrementing refreshKey re-triggers the effect without changing filters.
    const [refreshKey, setRefreshKey] = useState(0)
    // Server-side search — searches payee and note fields
    // Input is controlled by `search`; API calls use `debouncedSearch` (300ms delay)
    const [search, setSearch] = useState(() => searchParams.get('search') ?? '')
    const [debouncedSearch, setDebouncedSearch] = useState(search)
    // Server-side sorting — triggers re-fetch
    const [sortField, setSortField] = useState<'date' | 'payee' | 'category_name' | 'account_name' | 'amount' | 'status'>('date')
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

    // Date filter state
    const initDatePreset = (): DatePreset => {
        if (searchParams.get('date_from') || searchParams.get('date_to')) return 'custom'
        return 'this_month'
    }
    const [datePreset, setDatePreset] = useState<DatePreset>(initDatePreset)
    const [dateFrom, setDateFrom] = useState(() => {
        const urlFrom = searchParams.get('date_from')
        if (urlFrom) return urlFrom
        const range = getDateRange('this_month')
        return range?.from ?? ''
    })
    const [dateTo, setDateTo] = useState(() => {
        const urlTo = searchParams.get('date_to')
        if (urlTo) return urlTo
        const range = getDateRange('this_month')
        return range?.to ?? ''
    })

    // Pagination state
    const [page, setPage] = useState(1)
    const [pageSize, setPageSize] = useState(50)
    const [totalItems, setTotalItems] = useState(0)
    const [totalPages, setTotalPages] = useState(1)

    // Totals from backend (per-currency aggregation across all filtered rows)
    const [totals, setTotals] = useState<Totals | null>(null)

    // Notes expand state
    const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null)

    // Debounce search: wait 300ms after typing stops before triggering API fetch.
    // The input stays responsive (controlled by `search`), but the effect only
    // fires when `debouncedSearch` settles.
    const isFirstRender = useRef(true)
    useEffect(() => {
        // Skip the initial mount — debouncedSearch is already initialised to search
        if (isFirstRender.current) {
            isFirstRender.current = false
            return
        }
        const timer = setTimeout(() => {
            setDebouncedSearch(search)
            setPage(1)
            const next = new URLSearchParams(searchParams)
            if (search) next.set('search', search)
            else next.delete('search')
            setSearchParams(next)
        }, 300)
        return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search])

    // Accounts effect: runs on mount and after mutations (refreshKey).
    // Separate from the transactions effect so accounts aren't re-fetched on
    // every filter/search/sort/page change — but DO re-fetch after add/edit/delete
    // so that calculated_balance stays current.
    useEffect(() => {
        const token = localStorage.getItem('access_token')
        axios.get(`${getApiBaseUrl()}/api/v1/accounts`, {
            headers: { Authorization: `Bearer ${token}` },
        }).then(res => {
            setAccounts(res.data)
        }).catch(() => {})
    }, [refreshKey])

    // Categories effect: runs once on mount.
    // Fetching categories separately means filter dropdowns are populated
    // without triggering a re-fetch every time the user changes a filter.
    useEffect(() => {
        const token = localStorage.getItem('access_token')
        axios.get(`${getApiBaseUrl()}/api/v1/categories`, {
            headers: { Authorization: `Bearer ${token}` },
        }).then(res => {
            setCategories(res.data)
        }).catch(() => {
            // Silent failure — the category filter dropdown is non-critical
        })
    }, [])

    // Main filter effect: fetches transactions.
    // Re-runs whenever any filter changes or after a form submission (refreshKey).
    useEffect(() => {
        const token = localStorage.getItem('access_token')
        const headers = { Authorization: `Bearer ${token}` }
        setLoading(true)
        setError(null)

        const params: Record<string, string> = {}
        if (filterAccountId) params.account_id = filterAccountId
        if (filterCategoryId) params.category_id = filterCategoryId
        if (filterStatus) params.status = filterStatus
        if (dateFrom) params.date_from = dateFrom
        if (dateTo) params.date_to = dateTo
        if (debouncedSearch) params.search = debouncedSearch
        params.page = String(page)
        params.page_size = String(pageSize)
        params.sort_by = sortField
        params.sort_dir = sortDirection

        axios.get(`${getApiBaseUrl()}/api/v1/transactions`, { headers, params })
        .then((txRes) => {
            const data = txRes.data as PaginatedResponse
            setTransactions(data.items)
            setTotalItems(data.total)
            setTotalPages(data.total_pages)
            setTotals(data.totals)
        }).catch(() => {
            setError('Could not load transactions. Please try again.')
        }).finally(() => {
            setLoading(false)
        })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterAccountId, filterCategoryId, filterStatus, dateFrom, dateTo, debouncedSearch, page, pageSize, sortField, sortDirection, refreshKey])

    // Build lookup Map so each table row can resolve the account name in O(1).
    const accountById = new Map(accounts.map(a => [a.id, a.name]))

    // Find the active filter category name for the badge (if filter is set).
    const filterCategoryName = filterCategoryId
        ? (categories.find(c => c.id === filterCategoryId)?.name ?? filterCategoryId)
        : ''

    const handleTransactionAdded = () => {
        setShowAddForm(false)
        setShowTransferForm(false)
        setEditingTransaction(null)
        setEditingTransfer(null)
        setRefreshKey(k => k + 1)
        annualPlanCache.clear()
    }

    const handleEditTransaction = (tx: Transaction) => {
        if (tx.transaction_type === 'transfer') {
            setEditingTransfer(tx)
            setEditingTransaction(null)
        } else {
            setEditingTransaction(tx)
            setEditingTransfer(null)
        }
        setShowAddForm(false)
        setShowTransferForm(false)
        setTimeout(() => editFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    }

    const handleTransactionUpdated = () => {
        setEditingTransaction(null)
        setEditingTransfer(null)
        setRefreshKey(k => k + 1)
        annualPlanCache.clear()
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
            // Status changes affect which transactions count toward budget actuals
            annualPlanCache.clear()
        } catch {
            // Silent failure — a future improvement could show a toast here
        }
    }

    // --- Date preset handler ---

    const handleDatePreset = (preset: DatePreset) => {
        setDatePreset(preset)
        setPage(1)
        if (preset === 'custom') return // user sets dates manually
        const range = getDateRange(preset)
        setDateFrom(range?.from ?? '')
        setDateTo(range?.to ?? '')
    }

    // --- Server-side sorting ---

    const handleSort = (field: typeof sortField) => {
        if (sortField === field) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
        } else {
            setSortField(field)
            setSortDirection('asc')
        }
        setPage(1)
    }

    const sortIndicator = (field: string) =>
        sortField === field ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : ''

    const ariaSort = (field: string) =>
        sortField === field ? (sortDirection === 'asc' ? 'ascending' as const : 'descending' as const) : undefined

    // Transactions are already filtered server-side (including search)
    const displayedTransactions = transactions

    // Pagination display info
    const rangeStart = totalItems === 0 ? 0 : (page - 1) * pageSize + 1
    const rangeEnd = Math.min(page * pageSize, totalItems)

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
                                setEditingTransaction(null)
                                setEditingTransfer(null)
                            }}
                            className="btn-secondary cursor-pointer"
                        >
                            Add Transfer
                        </button>
                        <button
                            onClick={() => {
                                setShowAddForm((prev) => !prev)
                                setShowTransferForm(false)
                                setEditingTransaction(null)
                                setEditingTransfer(null)
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
                        <AddTransactionForm onTransactionAdded={handleTransactionAdded} defaultAccountId={filterAccountId || undefined} />
                    </div>
                )}
                {showTransferForm && (
                    <div className="mb-6">
                        <AddTransferForm onTransactionAdded={handleTransactionAdded} defaultAccountId={filterAccountId || undefined} />
                    </div>
                )}

                {/* Edit forms — positioned above the filter row so scrollIntoView
                    takes the user to the form, not the table row they clicked.
                    The ref sits on the outer wrapper; only one form is visible at a time. */}
                <div ref={editFormRef}>
                    {editingTransaction && (
                        <div className="mb-6">
                            <AddTransactionForm
                                key={editingTransaction.id}
                                onTransactionAdded={() => {}}
                                editingTransaction={editingTransaction}
                                onTransactionUpdated={handleTransactionUpdated}
                            />
                        </div>
                    )}
                    {editingTransfer && (
                        <div className="mb-6">
                            <AddTransferForm
                                key={editingTransfer.id}
                                onTransactionAdded={() => {}}
                                editingTransfer={editingTransfer}
                                onTransferUpdated={handleTransactionUpdated}
                            />
                        </div>
                    )}
                </div>

                {/* Date filter bar */}
                <div className="flex flex-wrap items-center gap-2 mb-4">
                    {([
                        ['this_month', 'This Month'],
                        ['last_month', 'Last Month'],
                        ['this_quarter', 'This Quarter'],
                        ['last_quarter', 'Last Quarter'],
                        ['this_year', 'This Year'],
                        ['custom', 'Custom'],
                        ['all', 'All'],
                    ] as [DatePreset, string][]).map(([preset, label]) => (
                        <button
                            key={preset}
                            onClick={() => handleDatePreset(preset)}
                            className={`text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${
                                datePreset === preset
                                    ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                                    : 'text-slate-400 hover:text-slate-200 border border-ocean-600 hover:border-sky-500'
                            }`}
                            aria-label={`Date filter: ${label}`}
                        >
                            {label}
                        </button>
                    ))}
                    {datePreset === 'custom' && (
                        <div className="flex items-center gap-2 ml-2">
                            <input
                                type="date"
                                value={dateFrom}
                                onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
                                className="input-base text-xs px-2 py-1"
                                aria-label="Date from"
                            />
                            <span className="text-slate-500 text-xs">to</span>
                            <input
                                type="date"
                                value={dateTo}
                                onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
                                className="input-base text-xs px-2 py-1"
                                aria-label="Date to"
                            />
                        </div>
                    )}
                </div>

                {/* Search */}
                <div className="flex items-center gap-2 mb-4">
                    <div className="relative">
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search payee or notes..."
                            className="input-base w-64 pr-8"
                            aria-label="Search payee or notes"
                        />
                        {search && (
                            <button
                                onClick={() => setSearch('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors cursor-pointer text-sm leading-none"
                                aria-label="Clear search"
                            >
                                ×
                            </button>
                        )}
                    </div>
                </div>

                {/* Filter row */}
                <div className="flex flex-wrap gap-4 mb-4">
                    <div>
                        <label htmlFor="filterAccount" className="label-base">Filter by account</label>
                        <select
                            id="filterAccount"
                            value={filterAccountId}
                            onChange={(e) => {
                                setFilterAccountId(e.target.value)
                                setPage(1)
                                const next = new URLSearchParams(searchParams)
                                if (e.target.value) next.set('account_id', e.target.value)
                                else next.delete('account_id')
                                setSearchParams(next)
                            }}
                            className="input-base"
                        >
                            <option value="">All accounts</option>
                            {accounts.map(a => (
                                <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                        </select>
                        {filterAccountId && (() => {
                            const acct = accounts.find(a => a.id === filterAccountId)
                            return acct ? (
                                <div className="text-sm text-slate-400 mt-1">
                                    Balance: <span className="text-sky-400 font-medium">{acct.calculated_balance} {acct.currency}</span>
                                </div>
                            ) : null
                        })()}
                    </div>
                    <div>
                        <label htmlFor="filterCategory" className="label-base">Filter by category</label>
                        <select
                            id="filterCategory"
                            value={filterCategoryId}
                            onChange={(e) => { setFilterCategoryId(e.target.value); setPage(1) }}
                            className="input-base"
                        >
                            <option value="">All categories</option>
                            {categories.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="filterStatus" className="label-base">Filter by status</label>
                        <select
                            id="filterStatus"
                            value={filterStatus}
                            onChange={(e) => {
                                setFilterStatus(e.target.value)
                                setPage(1)
                                // Sync URL
                                const next = new URLSearchParams(searchParams)
                                if (e.target.value) next.set('status', e.target.value)
                                else next.delete('status')
                                setSearchParams(next)
                            }}
                            className="input-base"
                        >
                            <option value="">All statuses</option>
                            <option value="pending">Pending</option>
                            <option value="cleared">Cleared</option>
                            <option value="reconciled">Reconciled</option>
                        </select>
                    </div>
                </div>

                {/* Active category filter badge — shown when a category is pre-selected
                    (e.g. from a drill-down link). x clears the filter. */}
                {filterCategoryId && (
                    <div className="flex items-center gap-2 mb-4">
                        <span className="text-sm text-slate-400">Filtered by:</span>
                        <span className="badge bg-sky-500/20 text-sky-400 border border-sky-500/30">
                            {filterCategoryName}
                        </span>
                        <button
                            onClick={() => {
                                setFilterCategoryId('')
                                setPage(1)
                                // Remove category_id from URL, keep status if set
                                const next = new URLSearchParams(searchParams)
                                next.delete('category_id')
                                setSearchParams(next)
                            }}
                            className="text-slate-400 hover:text-white transition-colors cursor-pointer text-sm leading-none"
                            aria-label="Clear category filter"
                        >
                            ×
                        </button>
                    </div>
                )}

                {/* Filtered totals — shown only when at least one filter is active */}
                {totals && (filterAccountId || filterCategoryId || filterStatus || debouncedSearch || dateFrom || dateTo) && (
                    <TransactionTotals totals={totals} />
                )}

                {/* Transaction list / empty state */}
                {transactions.length === 0 ? (
                    <div className="text-center py-20">
                        <p aria-hidden="true" className="text-5xl mb-4">💳</p>
                        <p className="text-slate-400 text-lg">
                            No transactions yet. Add one to get started.
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-auto rounded-xl border border-ocean-700 bg-ocean-800">
                            <table className="w-full text-sm min-w-[640px]">
                                <thead>
                                    <tr className="border-b border-ocean-700 bg-ocean-950">
                                        <th className="text-left px-4 py-3 font-medium" aria-sort={ariaSort('date')}>
                                            <button onClick={() => handleSort('date')} className="text-slate-400 hover:text-sky-400 transition-colors cursor-pointer select-none">Date{sortIndicator('date')}</button>
                                        </th>
                                        <th className="text-left px-4 py-3 font-medium" aria-sort={ariaSort('payee')}>
                                            <button onClick={() => handleSort('payee')} className="text-slate-400 hover:text-sky-400 transition-colors cursor-pointer select-none">Payee{sortIndicator('payee')}</button>
                                        </th>
                                        <th className="text-left px-4 py-3 font-medium" aria-sort={ariaSort('category_name')}>
                                            <button onClick={() => handleSort('category_name')} className="text-slate-400 hover:text-sky-400 transition-colors cursor-pointer select-none">Category{sortIndicator('category_name')}</button>
                                        </th>
                                        <th className="text-left px-4 py-3 font-medium" aria-sort={ariaSort('account_name')}>
                                            <button onClick={() => handleSort('account_name')} className="text-slate-400 hover:text-sky-400 transition-colors cursor-pointer select-none">Account{sortIndicator('account_name')}</button>
                                        </th>
                                        <th className="text-right px-4 py-3 font-medium" aria-sort={ariaSort('amount')}>
                                            <button onClick={() => handleSort('amount')} className="text-sky-400 hover:text-sky-300 transition-colors cursor-pointer select-none">Amount{sortIndicator('amount')}</button>
                                        </th>
                                        <th className="text-center px-4 py-3 text-slate-400 font-medium">Type</th>
                                        <th className="text-center px-4 py-3 font-medium" aria-sort={ariaSort('status')}>
                                            <button onClick={() => handleSort('status')} className="text-slate-400 hover:text-sky-400 transition-colors cursor-pointer select-none">Status{sortIndicator('status')}</button>
                                        </th>
                                        <th className="text-center px-4 py-3 text-slate-400 font-medium">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {displayedTransactions.map((tx) => (
                                        <Fragment key={tx.id}>
                                            <tr
                                                className="border-b border-ocean-700/50 hover:bg-ocean-700/30 transition-colors cursor-pointer"
                                                onClick={() => handleEditTransaction(tx)}
                                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleEditTransaction(tx) } }}
                                                tabIndex={0}
                                                aria-label="Click to edit"
                                            >
                                                <td className="px-4 py-3 text-slate-300">{tx.date}</td>
                                                <td className="px-4 py-3 text-slate-100">
                                                    {tx.payee ?? <span className="text-slate-500 italic">—</span>}
                                                </td>
                                                <td className="px-4 py-3 text-slate-300">
                                                    {tx.category_icon && <span className="mr-1">{tx.category_icon}</span>}
                                                    {tx.is_split ? (
                                                        <span className="badge bg-sky-500/20 text-sky-400 border border-sky-500/30">split</span>
                                                    ) : (tx.category_name || '—')}
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
                                                        onClick={(e) => { e.stopPropagation(); handleStatusToggle(tx) }}
                                                        className={`badge cursor-pointer hover:opacity-80 transition-opacity ${STATUS_BADGE[tx.status] ?? 'bg-ocean-700 text-slate-400'}`}
                                                    >
                                                        {tx.status}
                                                    </button>
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleEditTransaction(tx) }}
                                                            aria-label={`Edit transaction ${tx.payee ?? tx.id}`}
                                                            className="text-xs px-2.5 py-1 rounded border border-ocean-600 text-slate-400 hover:text-slate-200 hover:border-sky-500 transition-colors cursor-pointer"
                                                        >
                                                            Edit
                                                        </button>
                                                        {tx.note && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    setExpandedNoteId(prev => prev === tx.id ? null : tx.id)
                                                                }}
                                                                aria-label={`Toggle note for ${tx.payee ?? tx.id}`}
                                                                className={`text-xs px-1.5 py-1 rounded border transition-colors cursor-pointer ${
                                                                    expandedNoteId === tx.id
                                                                        ? 'border-sky-500 text-sky-400'
                                                                        : 'border-ocean-600 text-slate-400 hover:text-slate-200 hover:border-sky-500'
                                                                }`}
                                                            >
                                                                📝
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                            {expandedNoteId === tx.id && tx.note && (
                                                <tr className="bg-ocean-900/50">
                                                    <td colSpan={8} className="px-8 py-2 text-sm text-slate-300 italic">
                                                        {tx.note}
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination controls */}
                        <div className="flex items-center justify-between mt-4" aria-label="Pagination">
                            <span className="text-sm text-slate-400">
                                Showing {rangeStart}-{rangeEnd} of {totalItems} transactions
                            </span>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page <= 1}
                                    className="text-sm px-3 py-1.5 rounded border border-ocean-600 text-slate-400 hover:text-slate-200 hover:border-sky-500 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                    aria-label="Previous page"
                                >
                                    {'< Prev'}
                                </button>
                                <span className="text-sm text-slate-300">
                                    Page {page} of {totalPages}
                                </span>
                                <button
                                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                    disabled={page >= totalPages}
                                    className="text-sm px-3 py-1.5 rounded border border-ocean-600 text-slate-400 hover:text-slate-200 hover:border-sky-500 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                    aria-label="Next page"
                                >
                                    {'Next >'}
                                </button>
                                <select
                                    value={pageSize}
                                    onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}
                                    className="input-base text-sm px-2 py-1"
                                    aria-label="Page size"
                                >
                                    <option value={25}>25</option>
                                    <option value={50}>50</option>
                                    <option value={100}>100</option>
                                </select>
                                <span className="text-xs text-slate-500">per page</span>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </Layout>
    )
}

export default TransactionsPage
