// pages/RegisterPage.tsx
//
// Standalone full-screen register card. Same visual treatment as LoginPage.
// Does NOT use Layout — unauthenticated page.
//
// On successful registration, immediately logs in and redirects to /dashboard.
// Stores access_token AND user_email in localStorage (Layout uses the email).

import axios from 'axios'
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import type { SyntheticEvent } from 'react'
import { getApiBaseUrl } from '../lib/api'

function RegisterPage() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const navigate = useNavigate()

    const handleSubmit = async (e: SyntheticEvent) => {
        e.preventDefault()
        setError(null)

        if (password !== confirmPassword) {
            setError('Passwords do not match. Please try again')
            return
        }

        try {
            await axios.post(
                `${getApiBaseUrl()}/api/v1/auth/register`,
                { email, password }
            )
            try {
                const response = await axios.post(
                    `${getApiBaseUrl()}/api/v1/auth/login`,
                    { email, password }
                )
                localStorage.setItem('access_token', response.data.access_token)
                localStorage.setItem('user_email', email.toLowerCase())
                navigate('/dashboard')
            } catch {
                setError('Invalid Credentials')
            }
        } catch {
            setError('A user with this email already exists.')
        }
    }

    return (
        <div className="min-h-screen bg-ocean-900 flex items-center justify-center px-4">
            <div className="w-full max-w-md">

                {/* Card */}
                <div className="bg-ocean-800 border border-ocean-700 rounded-xl p-8 shadow-2xl">

                    {/* Brand header */}
                    <div className="text-center mb-8">
                        <div aria-hidden="true" className="text-4xl mb-3">🌊</div>
                        <h1 className="text-2xl font-bold">
                            <span className="text-sky-500">Tidal</span>
                        </h1>
                        <p className="text-slate-400 text-sm mt-1">Create your account</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div>
                            <label
                                htmlFor="email"
                                className="label-base"
                            >
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

                        <div>
                            <label
                                htmlFor="password"
                                className="label-base"
                            >
                                Password
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="input-base"
                                required
                            />
                        </div>

                        <div>
                            <label
                                htmlFor="confirmPassword"
                                className="label-base"
                            >
                                Confirm Password
                            </label>
                            <input
                                id="confirmPassword"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="input-base"
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
                            className="btn-primary w-full cursor-pointer"
                        >
                            Register
                        </button>
                    </form>

                    <p className="text-center text-sm text-slate-400 mt-6">
                        Already have an account?{' '}
                        <Link to="/login" className="text-sky-400 hover:text-sky-300 transition-colors">
                            Sign in
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    )
}

export default RegisterPage
