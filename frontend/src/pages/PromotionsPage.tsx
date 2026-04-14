// pages/PromotionsPage.tsx
//
// Purpose: Interest promotion tracker — tracks 0% deals, BNPL, balance transfers.
//          Shows urgency, progress, and required payments to clear before deadline.

import axios from 'axios'
import { useEffect, useRef, useState } from 'react'
import Layout from '../components/Layout'
import AddPromotionForm from '../components/AddPromotionForm'
import { getApiBaseUrl } from '../lib/api'

type Promotion = {
    id: string
    user_id: string
    account_id: string | null
    name: string
    promotion_type: string
    original_balance: string
    interest_rate: string
    start_date: string
    end_date: string
    minimum_monthly_payment: string | null
    is_active: boolean
    notes: string | null
    created_at: string
    updated_at: string
    days_remaining: number
    required_monthly_payment: string | null
    total_paid: string
    remaining_balance: string
    urgency: string
}

const URGENCY_STYLE: Record<string, string> = {
    critical: 'bg-danger/20 text-danger border border-danger/30 animate-pulse',
    warning: 'bg-warning/20 text-warning border border-warning/30',
    caution: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
    ok: 'bg-teal-500/20 text-teal-400 border border-teal-500/30',
    expired: 'bg-slate-500/20 text-slate-400 border border-slate-500/30',
}

const URGENCY_ICON: Record<string, string> = {
    critical: '🔴', warning: '🟠', caution: '🟡', ok: '🟢', expired: '⚫',
}

const TYPE_LABEL: Record<string, string> = {
    balance_transfer: 'Balance Transfer',
    bnpl: 'BNPL',
    deferred_interest: 'Deferred Interest',
    other: 'Other',
}

function PromotionsPage() {
    const [promotions, setPromotions] = useState<Promotion[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [activeOnly, setActiveOnly] = useState(true)
    const [showForm, setShowForm] = useState(false)
    const [editingPromotion, setEditingPromotion] = useState<Promotion | null>(null)
    const editFormRef = useRef<HTMLDivElement>(null)
    const [refreshKey, setRefreshKey] = useState(0)

    useEffect(() => {
        const token = localStorage.getItem('access_token')
        setLoading(true)
        setError(null)
        const params: Record<string, string> = {}
        if (activeOnly) params.active_only = 'true'
        axios.get(`${getApiBaseUrl()}/api/v1/promotions`, {
            headers: { Authorization: `Bearer ${token}` }, params,
        }).then(res => setPromotions(res.data))
          .catch(() => setError('Could not load promotions. Please try again.'))
          .finally(() => setLoading(false))
    }, [activeOnly, refreshKey])

    const handleSaved = () => {
        setShowForm(false)
        setEditingPromotion(null)
        setRefreshKey(k => k + 1)
    }

    const handleEdit = (promo: Promotion) => {
        setShowForm(false)
        setEditingPromotion(promo)
        setTimeout(() => editFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    }

    const handleDelete = async (id: string) => {
        if (!window.confirm('Delete this promotion? This cannot be undone.')) return
        const token = localStorage.getItem('access_token')
        try {
            await axios.delete(`${getApiBaseUrl()}/api/v1/promotions/${id}`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            setRefreshKey(k => k + 1)
        } catch (err: unknown) {
            const message = (err as { response?: { data?: { detail?: string } } })
                ?.response?.data?.detail ?? 'Could not delete promotion.'
            window.alert(message)
        }
    }

    if (loading) return <Layout><p className="text-slate-400 text-center py-20 text-lg">Loading...</p></Layout>
    if (error) return <Layout><p className="text-coral-400 text-center py-20">{error}</p></Layout>

    const progressPct = (promo: Promotion) => {
        const paid = parseFloat(promo.total_paid)
        const total = parseFloat(promo.original_balance)
        return total > 0 ? Math.min((paid / total) * 100, 100) : 0
    }

    const progressColor = (urgency: string) => {
        if (urgency === 'critical') return 'bg-danger'
        if (urgency === 'warning') return 'bg-warning'
        if (urgency === 'caution') return 'bg-amber-500'
        if (urgency === 'expired') return 'bg-slate-500'
        return 'bg-teal-500'
    }

    return (
        <Layout>
            <div className="max-w-4xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-slate-100">Promotions</h2>
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                            <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} className="accent-sky-500" />
                            Active only
                        </label>
                        <button onClick={() => { setShowForm(p => !p); setEditingPromotion(null) }} className="btn-primary cursor-pointer">
                            Add Promotion
                        </button>
                    </div>
                </div>

                {showForm && (
                    <div className="mb-6">
                        <AddPromotionForm onPromotionSaved={handleSaved} />
                    </div>
                )}
                {editingPromotion && (
                    <div ref={editFormRef} className="mb-6">
                        <AddPromotionForm key={editingPromotion.id} onPromotionSaved={handleSaved} editingPromotion={editingPromotion} />
                    </div>
                )}

                {promotions.length === 0 ? (
                    <div className="text-center py-20">
                        <p aria-hidden="true" className="text-5xl mb-4">💳</p>
                        <p className="text-slate-400 text-lg">No promotions found. Add one to track your 0% deals.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {promotions.map(promo => (
                            <div key={promo.id} className="bg-ocean-800 border border-ocean-700 rounded-xl p-5 cursor-pointer hover:border-ocean-600 transition-colors" onClick={() => handleEdit(promo)} aria-label="Click to edit">
                                {/* Header: name + type + urgency */}
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-3">
                                        <h3 className="text-lg font-semibold text-slate-100">{promo.name}</h3>
                                        <span className="badge bg-sky-500/20 text-sky-400">{TYPE_LABEL[promo.promotion_type] ?? promo.promotion_type}</span>
                                    </div>
                                    <span className={`badge ${URGENCY_STYLE[promo.urgency] ?? ''}`}>
                                        {URGENCY_ICON[promo.urgency]} {promo.urgency.toUpperCase()}
                                    </span>
                                </div>

                                {/* Progress bar */}
                                <div className="w-full bg-ocean-900 rounded-full h-3 mb-3 overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all ${progressColor(promo.urgency)}`}
                                        style={{ width: `${progressPct(promo)}%` }}
                                    />
                                </div>

                                {/* Key figures */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-3">
                                    <div>
                                        <span className="text-slate-500 block">Original</span>
                                        <span className="text-slate-100 font-medium">{promo.original_balance}</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500 block">Paid</span>
                                        <span className="text-teal-400 font-medium">{promo.total_paid}</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500 block">Remaining</span>
                                        <span className="text-sky-400 font-medium">{promo.remaining_balance}</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500 block">Days Left</span>
                                        <span className="text-slate-100 font-medium">{promo.days_remaining}</span>
                                    </div>
                                </div>

                                {/* Payment info */}
                                <div className="flex items-center gap-4 text-sm text-slate-400">
                                    {promo.required_monthly_payment && (
                                        <span>Required: <span className="text-sky-400">{promo.required_monthly_payment}/mo</span></span>
                                    )}
                                    {promo.minimum_monthly_payment && (
                                        <span>Minimum: <span className="text-slate-300">{promo.minimum_monthly_payment}/mo</span></span>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-ocean-700">
                                    <button onClick={(e) => { e.stopPropagation(); handleEdit(promo) }} className="text-xs px-2.5 py-1 rounded border border-ocean-600 text-slate-400 hover:text-slate-200 hover:border-sky-500 transition-colors cursor-pointer">Edit</button>
                                    <button onClick={(e) => { e.stopPropagation(); handleDelete(promo.id) }} className="text-xs px-2.5 py-1 rounded border border-ocean-600 text-slate-400 hover:text-coral-400 hover:border-coral-500 transition-colors cursor-pointer">Delete</button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Layout>
    )
}

export default PromotionsPage
