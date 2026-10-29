// pages/BankFeedsPage.tsx
//
// Purpose: Connect banks via Open Banking and pull their transactions in.
//
// Flow:
//   1. Pick a country and bank → "Connect" → the browser goes to the bank's
//      consent screen (window.location, not the router — it's another site).
//   2. The bank redirects to /bank-feeds/callback (BankFeedCallbackPage),
//      which completes the connection and comes back here.
//   3. Link each bank account to a Tidal account of the same currency.
//   4. "Sync now" imports booked transactions. Dedup is server-side, so
//      syncing twice, or after a CSV import of the same month, is harmless.
//
// Imported rows arrive uncategorised and cleared, like a CSV import.

import axios from 'axios'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import Layout from '../components/Layout'
import { getApiBaseUrl } from '../lib/api'
import { annualPlanCache } from '../lib/annualPlanCache'

type BankAccountLink = {
    id: string
    name: string | null
    currency: string | null
    iban_last4: string | null
    account_id: string | null
    last_synced_at: string | null
}

type BankConnection = {
    id: string
    institution_name: string
    institution_country: string
    status: 'active' | 'expired'
    valid_until: string | null
    accounts: BankAccountLink[]
}

type Institution = {
    name: string
    country: string
    logo: string | null
    max_consent_days: number
}

type Account = {
    id: string
    name: string
    currency: string
}

type SyncResult = {
    created: number
    skipped_duplicates: number
}

const COUNTRIES = [
    { code: 'GB', label: 'United Kingdom' },
    { code: 'ES', label: 'España' },
]

const authHeaders = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` } })

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

function errorDetail(err: unknown, fallback: string): string {
    const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
    return typeof detail === 'string' ? detail : fallback
}

function BankFeedsPage() {
    const location = useLocation()
    const connectedBank = (location.state as { connected?: string } | null)?.connected

    const [connections, setConnections] = useState<BankConnection[]>([])
    const [accounts, setAccounts] = useState<Account[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [refreshKey, setRefreshKey] = useState(0)

    const [country, setCountry] = useState('GB')
    const [institutions, setInstitutions] = useState<Institution[]>([])
    const [bank, setBank] = useState('')
    const [notConfigured, setNotConfigured] = useState(false)
    const [connectError, setConnectError] = useState<string | null>(null)
    const [connecting, setConnecting] = useState(false)

    // Per bank-account messages, keyed by link id.
    const [syncingId, setSyncingId] = useState<string | null>(null)
    const [messages, setMessages] = useState<Record<string, { text: string, isError: boolean }>>({})

    useEffect(() => {
        setError(null)
        Promise.all([
            axios.get(`${getApiBaseUrl()}/api/v1/bank-feeds/connections`, authHeaders()),
            axios.get(`${getApiBaseUrl()}/api/v1/accounts`, authHeaders()),
        ])
            .then(([connRes, accRes]) => {
                setConnections(connRes.data)
                setAccounts(accRes.data)
            })
            .catch(() => setError('Could not load bank feeds. Please try again.'))
            .finally(() => setLoading(false))
    }, [refreshKey])

    useEffect(() => {
        setInstitutions([])
        setBank('')
        axios.get(`${getApiBaseUrl()}/api/v1/bank-feeds/institutions`, { ...authHeaders(), params: { country } })
            .then(res => {
                setInstitutions(res.data)
                setBank(res.data[0]?.name ?? '')
            })
            .catch(err => {
                if (err?.response?.status === 503) setNotConfigured(true)
                else setConnectError('Could not load the list of banks.')
            })
    }, [country])

    const handleConnect = async () => {
        setConnectError(null)
        setConnecting(true)
        try {
            const res = await axios.post(
                `${getApiBaseUrl()}/api/v1/bank-feeds/connections`,
                { institution: bank, country },
                authHeaders(),
            )
            window.location.assign(res.data.auth_url)
        } catch (err) {
            setConnectError(errorDetail(err, 'Could not start connecting. Please try again.'))
            setConnecting(false)
        }
    }

    const setMessage = (linkId: string, text: string, isError: boolean) =>
        setMessages(prev => ({ ...prev, [linkId]: { text, isError } }))

    const handleLink = async (link: BankAccountLink, accountId: string) => {
        try {
            const res = await axios.put(
                `${getApiBaseUrl()}/api/v1/bank-feeds/links/${link.id}`,
                { account_id: accountId || null },
                authHeaders(),
            )
            setConnections(prev => prev.map(c => ({
                ...c,
                accounts: c.accounts.map(a => a.id === link.id ? res.data : a),
            })))
        } catch (err) {
            setMessage(link.id, errorDetail(err, 'Could not link this account.'), true)
        }
    }

    const handleSync = async (link: BankAccountLink) => {
        setSyncingId(link.id)
        try {
            const res = await axios.post(
                `${getApiBaseUrl()}/api/v1/bank-feeds/links/${link.id}/sync`,
                {},
                authHeaders(),
            )
            const result: SyncResult = res.data
            if (result.created > 0) annualPlanCache.clear()
            setMessage(link.id, `${result.created} new, ${result.skipped_duplicates} already imported`, false)
            setConnections(prev => prev.map(c => ({
                ...c,
                accounts: c.accounts.map(a => a.id === link.id ? { ...a, last_synced_at: new Date().toISOString() } : a),
            })))
        } catch (err) {
            setMessage(link.id, errorDetail(err, 'Sync failed. Please try again.'), true)
        } finally {
            setSyncingId(null)
        }
    }

    const handleRemove = async (connection: BankConnection) => {
        if (!window.confirm(`Remove ${connection.institution_name}? Transactions already imported are kept.`)) return
        try {
            await axios.delete(`${getApiBaseUrl()}/api/v1/bank-feeds/connections/${connection.id}`, authHeaders())
            setRefreshKey(k => k + 1)
        } catch {
            setError('Could not remove the connection. Please try again.')
        }
    }

    if (loading) return <Layout><p className="text-slate-400 text-center py-20 text-lg">Loading...</p></Layout>

    return (
        <Layout>
            <div className="max-w-4xl mx-auto">
                <h2 className="text-2xl font-bold text-slate-100 mb-6">Bank Feeds</h2>

                {connectedBank && (
                    <div className="bg-teal-500/10 border border-teal-500/30 rounded-lg px-3 py-2.5 mb-6">
                        <p className="text-teal-400 text-sm">{connectedBank} connected. Link its accounts below, then sync.</p>
                    </div>
                )}

                {error && <p className="text-coral-400 mb-6">{error}</p>}

                {/* --- Connect a bank --- */}
                <div className="card mb-8">
                    <h3 className="text-lg font-semibold text-slate-100 mb-4">Connect a bank</h3>
                    {notConfigured ? (
                        <p className="text-slate-400 text-sm">Bank feeds are not set up on this server.</p>
                    ) : (
                        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                            <div>
                                <label htmlFor="bank-country" className="label-base">Country</label>
                                <select id="bank-country" className="input-base" value={country} onChange={e => setCountry(e.target.value)}>
                                    {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                                </select>
                            </div>
                            <div className="flex-1">
                                <label htmlFor="bank-name" className="label-base">Bank</label>
                                <select id="bank-name" className="input-base" value={bank} onChange={e => setBank(e.target.value)}>
                                    {institutions.map(i => <option key={i.name} value={i.name}>{i.name}</option>)}
                                </select>
                            </div>
                            <button
                                onClick={handleConnect}
                                disabled={!bank || connecting}
                                className="btn-primary cursor-pointer disabled:opacity-60"
                            >
                                Connect
                            </button>
                        </div>
                    )}
                    {connectError && <p className="text-coral-400 text-sm mt-3">{connectError}</p>}
                    {!notConfigured && (
                        <p className="text-slate-500 text-xs mt-3">
                            You'll approve read-only access at your bank. Tidal never sees your bank login.
                        </p>
                    )}
                </div>

                {/* --- Connected banks --- */}
                {connections.length === 0 ? (
                    <p className="text-slate-400 text-center py-10">No banks connected yet.</p>
                ) : (
                    <div className="space-y-6">
                        {connections.map(connection => {
                            const expired = connection.status === 'expired'
                            return (
                                <div key={connection.id} className="card">
                                    <div className="flex items-center justify-between mb-4">
                                        <div>
                                            <h3 className="text-lg font-semibold text-slate-100">{connection.institution_name}</h3>
                                            <p className={`text-xs ${expired ? 'text-coral-400' : 'text-slate-400'}`}>
                                                {expired
                                                    ? 'Consent expired. Remove and connect again to keep syncing.'
                                                    : connection.valid_until && `Access until ${fmtDate(connection.valid_until)}`}
                                            </p>
                                        </div>
                                        <button onClick={() => handleRemove(connection)} className="btn-secondary cursor-pointer">
                                            Remove
                                        </button>
                                    </div>

                                    <ul className="divide-y divide-ocean-700">
                                        {connection.accounts.map(link => {
                                            const label = link.name ?? 'Account'
                                            const options = accounts.filter(a => !link.currency || a.currency === link.currency)
                                            const message = messages[link.id]
                                            return (
                                                <li key={link.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                                                    <div className="flex-1">
                                                        <p className="text-slate-100">{label}</p>
                                                        <p className="text-slate-400 text-xs">
                                                            {link.iban_last4 && `•••• ${link.iban_last4}`} {link.currency}
                                                            {link.last_synced_at && ` · last synced ${fmtDate(link.last_synced_at)}`}
                                                        </p>
                                                        {message && (
                                                            <p className={`text-xs mt-1 ${message.isError ? 'text-coral-400' : 'text-teal-400'}`}>
                                                                {message.text}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <label htmlFor={`link-${link.id}`} className="sr-only">Link {label} to</label>
                                                        <select
                                                            id={`link-${link.id}`}
                                                            className="input-base"
                                                            value={link.account_id ?? ''}
                                                            onChange={e => handleLink(link, e.target.value)}
                                                        >
                                                            <option value="">— Not linked —</option>
                                                            {options.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                                        </select>
                                                    </div>
                                                    <button
                                                        onClick={() => handleSync(link)}
                                                        disabled={!link.account_id || expired || syncingId === link.id}
                                                        className="btn-primary cursor-pointer disabled:opacity-60"
                                                    >
                                                        {syncingId === link.id ? 'Syncing…' : 'Sync now'}
                                                    </button>
                                                </li>
                                            )
                                        })}
                                    </ul>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </Layout>
    )
}

export default BankFeedsPage
