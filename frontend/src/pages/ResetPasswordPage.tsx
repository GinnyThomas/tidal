// pages/ResetPasswordPage.tsx
//
// Standalone (no Layout) page opened from the link in a reset email:
//   /reset-password?token=<raw token>
//
// Flow:
//   - No token in the URL → show the "invalid link" state straight away.
//   - New + confirm must match (checked client-side before any API call).
//   - POST /api/v1/auth/reset-password { token, new_password } → 204.
//   - Success → redirect to /login with router state { passwordReset: true },
//     which LoginPage turns into a "Password updated" banner.
//   - Rejected token (used / expired / unknown) → show the API's detail and a
//     link to request a fresh one.

import axios from 'axios'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { SyntheticEvent } from 'react'
import { getApiBaseUrl } from '../lib/api'
import PasswordToggleButton from '../components/PasswordToggleButton'

const INVALID_LINK_MESSAGE = 'This reset link is invalid or has expired.'

function ResetPasswordPage() {
    const [searchParams] = useSearchParams()
    const token = searchParams.get('token')
    const navigate = useNavigate()

    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [showNew, setShowNew] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)
    const [error, setError] = useState<string | null>(token ? null : INVALID_LINK_MESSAGE)
    // True once we know the token itself is bad — retrying with it is pointless.
    const [tokenRejected, setTokenRejected] = useState(!token)
    const [submitting, setSubmitting] = useState(false)

    const handleSubmit = async (e: SyntheticEvent) => {
        e.preventDefault()
        setError(null)

        if (newPassword !== confirmPassword) {
            setError('Passwords do not match. Please try again.')
            return
        }

        setSubmitting(true)
        try {
            await axios.post(
                `${getApiBaseUrl()}/api/v1/auth/reset-password`,
                { token, new_password: newPassword }
            )
            navigate('/login', { state: { passwordReset: true } })
        } catch (err: unknown) {
            const response = (err as { response?: { status?: number; data?: { detail?: unknown } } })?.response
            const detail = response?.data?.detail
            if (response?.status === 400) {
                // Only a 400 means the token itself was rejected (unknown / used /
                // expired). Other statuses (e.g. 503) say nothing about the token.
                setError(typeof detail === 'string' ? detail : INVALID_LINK_MESSAGE)
                setTokenRejected(true)
            } else if (response?.status === 422) {
                // Pydantic validation (detail is a list) — in practice the 8-char minimum.
                setError('Password must be at least 8 characters.')
            } else {
                setError('Something went wrong. Please try again.')
            }
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
                        <p className="text-slate-400 text-sm mt-1">Choose a new password</p>
                    </div>

                    {tokenRejected ? (
                        <div className="space-y-4">
                            <div className="bg-coral-500/10 border border-coral-500/30 rounded-lg px-3 py-2.5">
                                <p className="text-coral-400 text-sm">{error}</p>
                            </div>
                            <p className="text-center text-sm">
                                <Link to="/forgot-password" className="text-sky-400 hover:text-sky-300 transition-colors">
                                    Request a new link
                                </Link>
                            </p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-5">
                            <div>
                                <label htmlFor="newPassword" className="label-base">
                                    New Password
                                </label>
                                <div className="relative">
                                    <input
                                        id="newPassword"
                                        type={showNew ? 'text' : 'password'}
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        className="input-base pr-10"
                                        minLength={8}
                                        required
                                    />
                                    <PasswordToggleButton show={showNew} onToggle={() => setShowNew(v => !v)} />
                                </div>
                            </div>

                            <div>
                                <label htmlFor="confirmNewPassword" className="label-base">
                                    Confirm New Password
                                </label>
                                <div className="relative">
                                    <input
                                        id="confirmNewPassword"
                                        type={showConfirm ? 'text' : 'password'}
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className="input-base pr-10"
                                        minLength={8}
                                        required
                                    />
                                    <PasswordToggleButton show={showConfirm} onToggle={() => setShowConfirm(v => !v)} />
                                </div>
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
                                Reset password
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

export default ResetPasswordPage
