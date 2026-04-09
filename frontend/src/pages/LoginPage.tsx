// pages/LoginPage.tsx
//
// Standalone full-screen login card. Does NOT use Layout — the nav bar
// is only shown to authenticated users on protected pages.
//
// Design: ocean-900 background, ocean-800 card, sky-500 brand header,
//         coral-500 submit button, sky-500 focus rings on inputs.
//
// NOTE: The <span>Tidal</span> inside the h1 is intentionally a separate
// element so that screen.getByText('Tidal') in tests can find it by exact
// text match (the emoji lives in a sibling element, not the same text node).

import axios from 'axios'
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import type { SyntheticEvent } from 'react'
import { getApiBaseUrl } from '../lib/api'
import DemoButton from '../components/DemoButton'

function LoginPage() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const navigate = useNavigate()

    const handleSubmit = async (e: SyntheticEvent) => {
        e.preventDefault()
        setError(null)
        try {
            const response = await axios.post(
                `${getApiBaseUrl()}/api/v1/auth/login`,
                { email, password }
            )
            localStorage.setItem('access_token', response.data.access_token)
            // Store email so Layout can display it in the authenticated nav bar.
            localStorage.setItem('user_email', email.toLowerCase())
            navigate('/dashboard')
        } catch {
            setError('Invalid Credentials')
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
                        <p className="text-slate-400 text-sm mt-1">Sign in to your account</p>
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
                            {/* Relative wrapper so the toggle button can be
                                absolutely positioned inside the right edge of the input. */}
                            <div className="relative">
                                <input
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="input-base pr-10"
                                    required
                                />
                                <button
                                    type="button"
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    onClick={() => setShowPassword(v => !v)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                                >
                                    {showPassword ? '🔒' : '👁️'}
                                </button>
                            </div>
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
                            Log In
                        </button>
                    </form>

                    {/* Divider between login form and demo button */}
                    <div className="flex items-center gap-3 my-4">
                        <div className="flex-1 border-t border-ocean-700" />
                        <span className="text-slate-500 text-xs">or</span>
                        <div className="flex-1 border-t border-ocean-700" />
                    </div>

                    <DemoButton />

                    <p className="text-center text-sm text-slate-400 mt-6">
                        Don't have an account?{' '}
                        <Link to="/register" className="text-sky-400 hover:text-sky-300 transition-colors">
                            Register
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    )
}

export default LoginPage
