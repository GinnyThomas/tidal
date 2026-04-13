// components/AddPromotionForm.tsx
//
// Purpose: Form for creating OR editing a promotion.

import axios from 'axios'
import { useState, useEffect } from 'react'
import type { SyntheticEvent } from 'react'
import { getApiBaseUrl } from '../lib/api'

type Account = { id: string; name: string }

export type EditingPromotion = {
    id: string
    name: string
    promotion_type: string
    account_id: string | null
    original_balance: string
    interest_rate: string
    start_date: string
    end_date: string
    minimum_monthly_payment: string | null
    is_active: boolean
    notes: string | null
}

type Props = {
    onPromotionSaved: () => void
    editingPromotion?: EditingPromotion
}

function AddPromotionForm({ onPromotionSaved, editingPromotion }: Props) {
    const isEditMode = editingPromotion !== undefined

    const [accounts, setAccounts] = useState<Account[]>([])
    const [name, setName] = useState(editingPromotion?.name ?? '')
    const [promotionType, setPromotionType] = useState(editingPromotion?.promotion_type ?? 'balance_transfer')
    const [accountId, setAccountId] = useState(editingPromotion?.account_id ?? '')
    const [originalBalance, setOriginalBalance] = useState(editingPromotion?.original_balance ?? '')
    const [interestRate, setInterestRate] = useState(editingPromotion?.interest_rate ?? '0.00')
    const [startDate, setStartDate] = useState(editingPromotion?.start_date ?? new Date().toISOString().split('T')[0])
    const [endDate, setEndDate] = useState(editingPromotion?.end_date ?? '')
    const [minimumPayment, setMinimumPayment] = useState(editingPromotion?.minimum_monthly_payment ?? '')
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [isActive, _setIsActive] = useState(editingPromotion?.is_active ?? true)
    const [notes, setNotes] = useState(editingPromotion?.notes ?? '')
    const [error, setError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)

    useEffect(() => {
        const token = localStorage.getItem('access_token')
        axios.get(`${getApiBaseUrl()}/api/v1/accounts`, {
            headers: { Authorization: `Bearer ${token}` },
        }).then(res => setAccounts(res.data)).catch(() => {})
    }, [])

    const handleSubmit = async (e: SyntheticEvent) => {
        e.preventDefault()
        if (isSubmitting) return
        setIsSubmitting(true)
        setError(null)
        const token = localStorage.getItem('access_token')
        const payload = {
            name, promotion_type: promotionType,
            account_id: accountId || null,
            original_balance: originalBalance,
            interest_rate: interestRate,
            start_date: startDate, end_date: endDate,
            minimum_monthly_payment: minimumPayment || null,
            is_active: isActive,
            notes: notes || null,
        }
        try {
            try {
                if (isEditMode) {
                    await axios.put(`${getApiBaseUrl()}/api/v1/promotions/${editingPromotion.id}`, payload,
                        { headers: { Authorization: `Bearer ${token}` } })
                } else {
                    await axios.post(`${getApiBaseUrl()}/api/v1/promotions`, payload,
                        { headers: { Authorization: `Bearer ${token}` } })
                }
                onPromotionSaved()
            } catch {
                setError(`Could not ${isEditMode ? 'update' : 'create'} promotion. Please try again.`)
            }
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="bg-ocean-800 border border-ocean-700 rounded-xl p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-200 mb-5">
                {isEditMode ? 'Edit Promotion' : 'New Promotion'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="promoName" className="label-base">Name</label>
                    <input id="promoName" type="text" value={name} onChange={e => setName(e.target.value)} className="input-base" required />
                </div>
                <div>
                    <label htmlFor="promoType" className="label-base">Type</label>
                    <select id="promoType" value={promotionType} onChange={e => setPromotionType(e.target.value)} className="input-base">
                        <option value="balance_transfer">Balance Transfer</option>
                        <option value="bnpl">Buy Now Pay Later</option>
                        <option value="deferred_interest">Deferred Interest</option>
                        <option value="other">Other</option>
                    </select>
                </div>
                <div>
                    <label htmlFor="promoAccount" className="label-base">Account (optional)</label>
                    <select id="promoAccount" value={accountId} onChange={e => setAccountId(e.target.value)} className="input-base">
                        <option value="">None</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                </div>
                <div>
                    <label htmlFor="promoBalance" className="label-base">Original Balance</label>
                    <input id="promoBalance" type="number" step="0.01" value={originalBalance} onChange={e => setOriginalBalance(e.target.value)} className="input-base" required />
                </div>
                <div>
                    <label htmlFor="promoRate" className="label-base">Interest Rate (%)</label>
                    <input id="promoRate" type="number" step="0.01" value={interestRate} onChange={e => setInterestRate(e.target.value)} className="input-base" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="promoStart" className="label-base">Start Date</label>
                        <input id="promoStart" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input-base" required />
                    </div>
                    <div>
                        <label htmlFor="promoEnd" className="label-base">End Date</label>
                        <input id="promoEnd" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="input-base" required />
                    </div>
                </div>
                <div>
                    <label htmlFor="promoMinPayment" className="label-base">Minimum Monthly Payment (optional)</label>
                    <input id="promoMinPayment" type="number" step="0.01" value={minimumPayment} onChange={e => setMinimumPayment(e.target.value)} className="input-base" />
                </div>
                <div>
                    <label htmlFor="promoNotes" className="label-base">Notes (optional)</label>
                    <textarea id="promoNotes" value={notes} onChange={e => setNotes(e.target.value)} className="input-base resize-none" rows={3} />
                </div>
                {error && (
                    <div className="bg-coral-500/10 border border-coral-500/30 rounded-lg px-3 py-2">
                        <p className="text-coral-400 text-sm">{error}</p>
                    </div>
                )}
                <button type="submit" disabled={isSubmitting} className="btn-primary w-full cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                    {isEditMode ? 'Update Promotion' : 'Save Promotion'}
                </button>
            </form>
        </div>
    )
}

export default AddPromotionForm
