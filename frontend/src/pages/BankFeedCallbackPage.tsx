// pages/BankFeedCallbackPage.tsx
//
// Purpose: Where the bank sends the user back after they approve (or refuse)
// access: /bank-feeds/callback?code=…&state=…  (or ?error=…).
//
// We hand code + state to the backend, which checks the state belongs to
// this user's pending connection and swaps the code for a bank session.
// The state is single use, so the POST must happen exactly once — React's
// StrictMode runs effects twice in development, hence the ref guard.

import axios from 'axios'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Layout from '../components/Layout'
import { getApiBaseUrl } from '../lib/api'

function BankFeedCallbackPage() {
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()
    const started = useRef(false)

    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const bankError = searchParams.get('error')

    // Problems we can see from the URL alone need no request.
    const urlError = bankError
        ? (searchParams.get('error_description') || 'Your bank did not grant access.')
        : (!code || !state) ? 'This link is incomplete. Please try connecting again.' : null
    const [requestError, setRequestError] = useState<string | null>(null)

    useEffect(() => {
        if (urlError || started.current) return
        started.current = true
        const token = localStorage.getItem('access_token')
        axios.post(
            `${getApiBaseUrl()}/api/v1/bank-feeds/connections/complete`,
            { code, state },
            { headers: { Authorization: `Bearer ${token}` } },
        )
            .then(res => navigate('/bank-feeds', { replace: true, state: { connected: res.data.institution_name } }))
            .catch(() => setRequestError('Could not finish connecting your bank. Please try again.'))
    }, [code, state, urlError, navigate])

    const error = urlError ?? requestError

    return (
        <Layout>
            <div className="max-w-xl mx-auto text-center py-20">
                {error ? (
                    <>
                        <p className="text-coral-400 mb-4">{error}</p>
                        <Link to="/bank-feeds" className="text-sky-400 hover:text-sky-300 transition-colors">
                            Back to bank feeds
                        </Link>
                    </>
                ) : (
                    <p className="text-slate-400 text-lg">Connecting your bank…</p>
                )}
            </div>
        </Layout>
    )
}

export default BankFeedCallbackPage
