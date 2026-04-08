// components/Layout.tsx
//
// Purpose: Shared page wrapper for all authenticated views.
//
// Provides:
//   - Top navigation bar with Tidal branding and nav links
//   - Active link highlighting using useLocation
//   - User email display (read from localStorage, stored at login/register)
//   - Logout button (clears localStorage, redirects to /login)
//   - Main content area with consistent padding
//
// Usage:
//   Every protected page wraps its content in <Layout>.
//   LoginPage and RegisterPage do NOT use Layout — they are full-screen
//   standalone cards without a nav bar.

import { useLocation, useNavigate, Link } from 'react-router-dom'
import type { ReactNode } from 'react'

type Props = {
    children: ReactNode
}

function Layout({ children }: Props) {
    const { pathname } = useLocation()
    const navigate = useNavigate()

    // Email is stored in localStorage at login/register time so it can be
    // displayed without a separate API call to /api/v1/users/me.
    const userEmail = localStorage.getItem('user_email') ?? ''

    const handleLogout = () => {
        localStorage.removeItem('access_token')
        localStorage.removeItem('user_email')
        navigate('/login')
    }

    // Returns Tailwind classes for a nav link, highlighting it when active.
    // We match on the exact path to avoid /dashboard matching /dashboard/something.
    const navClass = (path: string) => {
        const isActive = pathname === path
        return [
            'px-3 py-2 rounded-md text-sm font-medium transition-colors',
            isActive
                ? 'bg-ocean-800 text-sky-400'
                : 'text-slate-300 hover:text-sky-400 hover:bg-ocean-800',
        ].join(' ')
    }

    return (
        <div className="min-h-screen bg-ocean-900 flex flex-col">

            {/* ── Navigation bar ─────────────────────────────────────────── */}
            <nav className="bg-ocean-950 border-b border-ocean-700 px-6 py-3 flex items-center justify-between">

                {/* Logo — emoji is decorative, Tidal is the readable brand text */}
                <div className="flex items-center gap-2">
                    <span aria-hidden="true" className="text-2xl">🌊</span>
                    <span className="text-sky-500 font-bold text-xl">Tidal</span>
                </div>

                {/* Page links */}
                <div className="flex items-center gap-1">
                    <Link to="/dashboard" className={navClass('/dashboard')}>Dashboard</Link>
                    <Link to="/accounts"  className={navClass('/accounts')}>Accounts</Link>
                    <Link to="/categories" className={navClass('/categories')}>Categories</Link>
                </div>

                {/* User identity + logout */}
                <div className="flex items-center gap-3">
                    {userEmail && (
                        <span className="text-sm text-slate-400 hidden sm:inline">{userEmail}</span>
                    )}
                    <button
                        onClick={handleLogout}
                        className="px-3 py-1.5 text-sm rounded border border-ocean-600 text-slate-300 hover:text-white hover:border-sky-500 transition-colors cursor-pointer"
                    >
                        Log out
                    </button>
                </div>
            </nav>

            {/* ── Page content ───────────────────────────────────────────── */}
            <main className="flex-1 p-6">
                {children}
            </main>

        </div>
    )
}

export default Layout
