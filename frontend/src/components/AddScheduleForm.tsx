// components/AddScheduleForm.tsx
//
// Purpose: Form for creating or editing a recurring schedule.
//
// Props:
//   onScheduleAdded    — called after a successful create so the parent can
//                        re-fetch the list and optionally hide this form.
//   editingSchedule    — (optional) when provided, the form is in edit mode:
//                        fields are pre-populated and PUT replaces POST.
//   onScheduleUpdated  — (optional) called after a successful update (edit mode).
//
// Frequency-dependent fields:
//   - interval: shown for weekly and every_n_days — how many weeks/days
//     between each occurrence (e.g. every 2 weeks).
//   - day_of_month: shown for monthly, quarterly, annually — which calendar
//     day to run (e.g. the 1st of each month for a rent payment).
//
// Design decisions:
//   - Fetches accounts and categories on mount (same pattern as AddTransactionForm).
//   - start_date defaults to today so the form is valid without user input.
//   - interval and day_of_month are only sent when relevant to the frequency;
//     irrelevant fields are sent as null/1 so the backend always gets a clean body.
//   - Edit mode: when editingSchedule is provided, state initialises from the
//     existing values. The auto-select logic that sets the first dropdown option
//     is skipped in edit mode so the pre-populated IDs are preserved.
//   - The parent should key this component on editingSchedule.id so switching
//     to a different schedule always starts fresh.

import axios from 'axios'
import { useState, useEffect } from 'react'
import type { SyntheticEvent } from 'react'
import { getApiBaseUrl } from '../lib/api'
import { sortCategoriesByName } from '../lib/categories'
import { CURRENCIES } from '../lib/currencies'
import { GROUP_ORDER } from '../lib/budgetGroups'

type Account = { id: string; name: string }
type Category = { id: string; name: string }

type EditingSchedule = {
    id: string
    name: string
    account_id: string
    category_id: string
    amount: string
    currency: string
    frequency: string
    interval: number
    day_of_month: number | null
    start_date: string
    end_date: string | null
    auto_generate: boolean
    group: string | null
    payee: string | null
    note: string | null
}

type Props = {
    onScheduleAdded: () => void
    editingSchedule?: EditingSchedule
    onScheduleUpdated?: () => void
}

// Frequencies that use an interval (repeat every N weeks or N days)
const INTERVAL_FREQUENCIES = ['weekly', 'every_n_days']
// Frequencies that use a specific day of the month
const DAY_OF_MONTH_FREQUENCIES = ['monthly', 'quarterly', 'annually']

function AddScheduleForm({ onScheduleAdded, editingSchedule, onScheduleUpdated }: Props) {
    const isEditMode = editingSchedule !== undefined

    // Initialise from editingSchedule in edit mode; use defaults for create.
    const [accounts, setAccounts] = useState<Account[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [name, setName] = useState(editingSchedule?.name ?? '')
    const [accountId, setAccountId] = useState(editingSchedule?.account_id ?? '')
    const [categoryId, setCategoryId] = useState(editingSchedule?.category_id ?? '')
    const [amount, setAmount] = useState(editingSchedule?.amount ?? '')
    const [currency, setCurrency] = useState(editingSchedule?.currency ?? 'GBP')
    // Default to monthly — the most common recurrence for bills and subscriptions
    const [frequency, setFrequency] = useState(editingSchedule?.frequency ?? 'monthly')
    const [interval, setIntervalValue] = useState(editingSchedule?.interval ?? 1)
    const [dayOfMonth, setDayOfMonth] = useState<number | ''>(editingSchedule?.day_of_month ?? '')
    // Default to today so the form is immediately submittable
    const [startDate, setStartDate] = useState(
        editingSchedule?.start_date ?? new Date().toISOString().split('T')[0]
    )
    const [endDate, setEndDate] = useState(editingSchedule?.end_date ?? '')
    const [autoGenerate, setAutoGenerate] = useState(editingSchedule?.auto_generate ?? true)
    const [group, setGroup] = useState(editingSchedule?.group ?? '')
    const [payee, setPayee] = useState(editingSchedule?.payee ?? '')
    const [note, setNote] = useState(editingSchedule?.note ?? '')
    const [error, setError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Fetch accounts and categories to populate the dropdowns.
    // Both fetched in parallel via Promise.all to minimise load time.
    // Auto-select the first option only in create mode — edit mode already has
    // the correct IDs from editingSchedule.
    useEffect(() => {
        const token = localStorage.getItem('access_token')
        const headers = { Authorization: `Bearer ${token}` }
        Promise.all([
            axios.get(`${getApiBaseUrl()}/api/v1/accounts`, { headers }),
            axios.get(`${getApiBaseUrl()}/api/v1/categories`, { headers }),
        ]).then(([accountsRes, catsRes]) => {
            setAccounts(accountsRes.data)
            const sorted = sortCategoriesByName(catsRes.data as Category[])
            setCategories(sorted)
            // Only auto-select in create mode — preserves pre-populated IDs in edit mode
            if (!isEditMode && accountsRes.data.length > 0) setAccountId(accountsRes.data[0].id)
            if (!isEditMode && sorted.length > 0) setCategoryId(sorted[0].id)
        }).catch(() => {
            // Best-effort — silently leave dropdowns empty
        })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handleSubmit = async (e: SyntheticEvent) => {
        e.preventDefault()
        if (isSubmitting) return
        setIsSubmitting(true)
        setError(null)
        const token = localStorage.getItem('access_token')
        const body = {
            name,
            account_id: accountId,
            category_id: categoryId,
            amount,
            currency,
            frequency,
            // Only send interval when the frequency uses it; default 1 otherwise
            interval: INTERVAL_FREQUENCIES.includes(frequency) ? interval : 1,
            // Only send day_of_month when the frequency uses it
            day_of_month: DAY_OF_MONTH_FREQUENCIES.includes(frequency)
                ? (dayOfMonth === '' ? null : dayOfMonth)
                : null,
            start_date: startDate,
            end_date: endDate || null,
            auto_generate: autoGenerate,
            group: group || null,
            payee: payee || null,
            note: note || null,
        }
        const config = { headers: { Authorization: `Bearer ${token}` } }
        try {
            try {
                if (isEditMode && editingSchedule) {
                    await axios.put(
                        `${getApiBaseUrl()}/api/v1/schedules/${editingSchedule.id}`,
                        body,
                        config,
                    )
                    onScheduleUpdated?.()
                } else {
                    await axios.post(`${getApiBaseUrl()}/api/v1/schedules`, body, config)
                    onScheduleAdded()
                }
            } catch {
                setError(
                    isEditMode
                        ? 'Could not update schedule. Please try again.'
                        : 'Could not create schedule. Please try again.'
                )
            }
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="bg-ocean-800 border border-ocean-700 rounded-xl p-6 shadow-xl">
            <h3 className="section-header mb-5">{isEditMode ? 'Edit Schedule' : 'New Schedule'}</h3>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="schedName" className="label-base">Name</label>
                    <input
                        id="schedName"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="input-base"
                        required
                    />
                </div>

                <div>
                    <label htmlFor="schedAccount" className="label-base">Account</label>
                    <select
                        id="schedAccount"
                        value={accountId}
                        onChange={(e) => setAccountId(e.target.value)}
                        className="input-base"
                        required
                    >
                        {accounts.map((a) => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label htmlFor="schedCategory" className="label-base">Category</label>
                    <select
                        id="schedCategory"
                        value={categoryId}
                        onChange={(e) => setCategoryId(e.target.value)}
                        className="input-base"
                        required
                    >
                        {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label htmlFor="schedAmount" className="label-base">Amount</label>
                    <input
                        id="schedAmount"
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
                    <label htmlFor="schedCurrency" className="label-base">Currency</label>
                    <select
                        id="schedCurrency"
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
                    <label htmlFor="schedFrequency" className="label-base">Frequency</label>
                    <select
                        id="schedFrequency"
                        value={frequency}
                        onChange={(e) => setFrequency(e.target.value)}
                        className="input-base"
                    >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="every_n_days">Every N Days</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="annually">Annually</option>
                    </select>
                </div>

                {/* Shown for weekly and every_n_days — controls how many weeks/days between runs */}
                {INTERVAL_FREQUENCIES.includes(frequency) && (
                    <div>
                        <label htmlFor="schedInterval" className="label-base">Interval</label>
                        <input
                            id="schedInterval"
                            type="number"
                            value={interval}
                            onChange={(e) => setIntervalValue(Number(e.target.value))}
                            className="input-base"
                            min="1"
                            required
                        />
                    </div>
                )}

                {/* Shown for monthly, quarterly, annually — controls which calendar day to run */}
                {DAY_OF_MONTH_FREQUENCIES.includes(frequency) && (
                    <div>
                        <label htmlFor="schedDayOfMonth" className="label-base">Day of Month</label>
                        <input
                            id="schedDayOfMonth"
                            type="number"
                            value={dayOfMonth}
                            onChange={(e) =>
                                setDayOfMonth(e.target.value === '' ? '' : Number(e.target.value))
                            }
                            className="input-base"
                            min="1"
                            max="31"
                        />
                    </div>
                )}

                <div>
                    <label htmlFor="schedStartDate" className="label-base">Start Date</label>
                    <input
                        id="schedStartDate"
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="input-base"
                        required
                    />
                </div>

                <div>
                    <label htmlFor="schedEndDate" className="label-base">End Date (optional)</label>
                    <input
                        id="schedEndDate"
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="input-base"
                    />
                </div>

                {/* Checkbox: when true, the schedule engine auto-creates pending transactions */}
                <div className="flex items-center gap-3">
                    <input
                        id="schedAutoGenerate"
                        type="checkbox"
                        checked={autoGenerate}
                        onChange={(e) => setAutoGenerate(e.target.checked)}
                        className="w-4 h-4 accent-sky-500"
                    />
                    <label htmlFor="schedAutoGenerate" className="text-sm font-medium text-slate-300">
                        Auto-generate pending transactions
                    </label>
                </div>

                <div>
                    <label htmlFor="schedPayee" className="label-base">Payee (optional)</label>
                    <input
                        id="schedPayee"
                        type="text"
                        value={payee}
                        onChange={(e) => setPayee(e.target.value)}
                        className="input-base"
                    />
                </div>

                <div>
                    <label htmlFor="schedGroup" className="label-base">Group</label>
                    <select
                        id="schedGroup"
                        value={group}
                        onChange={(e) => setGroup(e.target.value)}
                        className="input-base"
                    >
                        <option value="">None</option>
                        {(GROUP_ORDER as readonly string[]).filter(g => g !== 'General').map(g => (
                            <option key={g} value={g}>{g}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label htmlFor="schedNote" className="label-base">Note (optional)</label>
                    <textarea
                        id="schedNote"
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
                    {isEditMode ? 'Update Schedule' : 'Save Schedule'}
                </button>
            </form>
        </div>
    )
}

export default AddScheduleForm
