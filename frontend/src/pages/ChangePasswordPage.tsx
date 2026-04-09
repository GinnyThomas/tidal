// pages/ChangePasswordPage.tsx
//
// Purpose: Lets an authenticated user change their password.
//          Wrapped in Layout for navigation.
//
// Features:
//   - Three fields: current password, new password, confirm new password.
//   - Each field has a show/hide toggle button (👁️ / 🔒).
//   - Client-side check: new password and confirm must match before the API call.
//   - POST /api/v1/auth/change-password with the stored JWT.
//   - On success: shows a success message and clears the fields.
//   - On failure: surfaces the API's detail message (e.g. "Current password is incorrect.").

import axios from 'axios'
import { useState } from 'react'
import type { SyntheticEvent } from 'react'
import Layout from '../components/Layout'
import { getApiBaseUrl } from '../lib/api'

function ChangePasswordPage() {
    const [currentPassword, setCurrentPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')

    // One show/hide state per field — toggled independently.
    const [showCurrent, setShowCurrent] = useState(false)
    const [showNew, setShowNew] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)

    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState(false)

    const handleSubmit = async (e: SyntheticEvent) => {
        e.preventDefault()
        setError(null)
        setSuccess(false)

        // Client-side validation — no point calling the API if the fields don't match.
        if (newPassword !== confirmPassword) {
            setError('Passwords do not match. Please try again.')
            return
        }

        const token = localStorage.getItem('access_token')
        try {
            await axios.post(
                `${getApiBaseUrl()}/api/v1/auth/change-password`,
                { current_password: currentPassword, new_password: newPassword },
                { headers: { Authorization: `Bearer ${token}` } }
            )
            setSuccess(true)
            // Clear the fields so the form is ready for another change if needed.
            setCurrentPassword('')
            setNewPassword('')
            setConfirmPassword('')
        } catch (err: unknown) {
            // Surface the API's detail message if available; fall back to a generic message.
            const detail =
                (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            setError(detail ?? 'Could not change password. Please try again.')
        }
    }

    // Reusable toggle button rendered inside each password field container.
    // type="button" is critical — without it, clicking would submit the form.
    const ToggleButton = ({
        show,
        onToggle,
    }: {
        show: boolean
        onToggle: () => void
    }) => (
        <button
            type="button"
            aria-label={show ? 'Hide password' : 'Show password'}
            onClick={onToggle}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
        >
            {show ? '🔒' : '👁️'}
        </button>
    )

    return (
        <Layout>
            <div className="max-w-md mx-auto">
                <div className="bg-ocean-800 border border-ocean-700 rounded-xl p-8">
                    <h2 className="text-2xl font-bold text-slate-100 mb-6">Change Password</h2>

                    <form onSubmit={handleSubmit} className="space-y-5">

                        {/* Current password */}
                        <div>
                            <label htmlFor="currentPassword" className="label-base">
                                Current Password
                            </label>
                            <div className="relative">
                                <input
                                    id="currentPassword"
                                    type={showCurrent ? 'text' : 'password'}
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                    className="input-base pr-10"
                                    required
                                />
                                <ToggleButton
                                    show={showCurrent}
                                    onToggle={() => setShowCurrent(v => !v)}
                                />
                            </div>
                        </div>

                        {/* New password */}
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
                                    required
                                />
                                <ToggleButton
                                    show={showNew}
                                    onToggle={() => setShowNew(v => !v)}
                                />
                            </div>
                        </div>

                        {/* Confirm new password */}
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
                                    required
                                />
                                <ToggleButton
                                    show={showConfirm}
                                    onToggle={() => setShowConfirm(v => !v)}
                                />
                            </div>
                        </div>

                        {/* Error message */}
                        {error && (
                            <div className="bg-coral-500/10 border border-coral-500/30 rounded-lg px-3 py-2.5">
                                <p className="text-coral-400 text-sm">{error}</p>
                            </div>
                        )}

                        {/* Success message */}
                        {success && (
                            <div className="bg-teal-500/10 border border-teal-500/30 rounded-lg px-3 py-2.5">
                                <p className="text-teal-400 text-sm">Password changed successfully.</p>
                            </div>
                        )}

                        <button
                            type="submit"
                            className="btn-primary w-full cursor-pointer"
                        >
                            Change Password
                        </button>
                    </form>
                </div>
            </div>
        </Layout>
    )
}

export default ChangePasswordPage
