// pages/ForgotPasswordPage.tsx
//
// Standalone (no Layout) page reached from "Forgot password?" on the login page.
// Collects an email and asks the backend to send a reset link.
//
// The backend replies with the same message whether or not the account
// exists (anti-enumeration), so we simply show its `detail` text and hide
// the form — there is no "account not found" state to handle here.

import axios from 'axios'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { SyntheticEvent } from 'react'
import { getApiBaseUrl } from '../lib/api'

function ForgotPasswordPage() {
    const [email, setEmail] = useState('')
    const [confirmation, setConfirmation] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)

    const handleSubmit = async (e: SyntheticEvent) => {
        e.preventDefault()
        setError(null)
        setSubmitting(true)
        try {
            const response = await axios.post(
                `${getApiBaseUrl()}/api/v1/auth/forgot-password`,
                { email }
            )
            setConfirmation(response.data.detail)
        } catch {
            setError('Something went wrong. Please try again.')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="min-h-screen bg-ocean-900 flex items-center justify-center px-4">
            <div className="w-full max-w-md">
                <div className="bg-ocean-800 border border-ocean-700 rounded-xl p-8 shadow-2xl">

                    <div className="text-center mb-8">
                        <div aria-hidden="true" className="text-4xl mb-3">🌊</div>
                        <h1 className="text-2xl font-bold">
                            <span className="text-sky-500">Tidal</span>
                        </h1>
                        <p className="text-slate-400 text-sm mt-1">Reset your password</p>
                    </div>

                    {confirmation ? (
                        <div className="bg-teal-500/10 border border-teal-500/30 rounded-lg px-3 py-2.5">
                            <p className="text-teal-400 text-sm">{confirmation}</p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-5">
                            <p className="text-slate-400 text-sm">
                                Enter the email you signed up with and we'll send you a link to reset your password.
                            </p>
                            <div>
                                <label htmlFor="email" className="label-base">
                                    Email
                                </label>
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="input-base"
                                    placeholder="you@example.com"
                                    required
                                />
                            </div>

                            {error && (
                                <div className="bg-coral-500/10 border border-coral-500/30 rounded-lg px-3 py-2.5">
                                    <p className="text-coral-400 text-sm">{error}</p>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={submitting}
                                className="btn-primary w-full cursor-pointer disabled:opacity-60"
                            >
                                Send reset link
                            </button>
                        </form>
                    )}

                    <p className="text-center text-sm text-slate-400 mt-6">
                        <Link to="/login" className="text-sky-400 hover:text-sky-300 transition-colors">
                            Back to log in
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    )
}

export default ForgotPasswordPage
