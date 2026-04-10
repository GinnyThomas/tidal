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
//   - Responsive hamburger menu on mobile (below md breakpoint)
//
// Mobile layout:
//   - Nav links and user actions are hidden; a hamburger button (☰) appears.
//   - Clicking the hamburger toggles a dropdown showing all links vertically
//     plus the user email and Log out button.
//   - Clicking any link in the dropdown closes the menu.
//
// Usage:
//   Every protected page wraps its content in <Layout>.
//   LoginPage and RegisterPage do NOT use Layout — they are full-screen
//   standalone cards without a nav bar.

import { useState } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import type { ReactNode } from 'react'

type Props = {
    children: ReactNode
}

function Layout({ children }: Props) {
    const { pathname } = useLocation()
    const navigate = useNavigate()
    // Controls the mobile dropdown visibility
    const [menuOpen, setMenuOpen] = useState(false)

    // Email is stored in localStorage at login/register time so it can be
    // displayed without a separate API call to /api/v1/users/me.
    const userEmail = localStorage.getItem('user_email') ?? ''

    const handleLogout = () => {
        localStorage.removeItem('access_token')
        localStorage.removeItem('user_email')
        navigate('/login')
    }

    // Returns Tailwind classes for a nav link, highlighting it when active.
    // Accepts a single path string or an array of paths — useful when multiple
    // routes map to the same nav item (e.g. /dashboard and /plan both render
    // the Monthly Plan View, so the Dashboard link should be active on either).
    const navClass = (paths: string | string[]) => {
        const pathList = Array.isArray(paths) ? paths : [paths]
        const isActive = pathList.includes(pathname)
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
            <nav className="bg-ocean-950 border-b border-ocean-700">

                {/* Main nav row — always visible */}
                <div className="px-4 sm:px-6 py-3 flex items-center justify-between">

                    {/* Logo — emoji is decorative, Tidal is the readable brand text */}
                    <div className="flex items-center gap-2">
                        <span aria-hidden="true" className="text-2xl">🌊</span>
                        <span className="text-sky-500 font-bold text-xl">Tidal</span>
                    </div>

                    {/* Page links — hidden on mobile, shown as row on md+ */}
                    <div className="hidden md:flex items-center gap-1">
                        <Link to="/dashboard"    className={navClass(['/dashboard', '/plan'])}>Dashboard</Link>
                        <Link to="/transactions" className={navClass('/transactions')}>Transactions</Link>
                        <Link to="/accounts"     className={navClass('/accounts')}>Accounts</Link>
                        <Link to="/categories"   className={navClass('/categories')}>Categories</Link>
                        <Link to="/schedules"    className={navClass('/schedules')}>Schedules</Link>
                    </div>

                    {/* User identity + account actions — hidden on mobile */}
                    <div className="hidden md:flex items-center gap-3">
                        {userEmail && (
                            <span className="text-sm text-slate-400">{userEmail}</span>
                        )}
                        <Link
                            to="/change-password"
                            className="px-3 py-1.5 text-sm rounded border border-ocean-600 text-slate-300 hover:text-white hover:border-sky-500 transition-colors"
                        >
                            Change Password
                        </Link>
                        <button
                            onClick={handleLogout}
                            className="px-3 py-1.5 text-sm rounded border border-ocean-600 text-slate-300 hover:text-white hover:border-sky-500 transition-colors cursor-pointer"
                        >
                            Log out
                        </button>
                    </div>

                    {/* Hamburger button — visible on mobile only */}
                    <button
                        onClick={() => setMenuOpen((prev) => !prev)}
                        className="md:hidden p-2 text-slate-300 hover:text-white transition-colors cursor-pointer"
                        aria-label="Toggle menu"
                        aria-expanded={menuOpen}
                    >
                        {menuOpen ? '✕' : '☰'}
                    </button>

                </div>

                {/* Mobile dropdown — slides in below the nav row when open */}
                {menuOpen && (
                    <div className="md:hidden border-t border-ocean-700 px-4 py-3 flex flex-col gap-1">

                        {/* Nav links stacked vertically */}
                        <Link to="/dashboard"    className={navClass(['/dashboard', '/plan'])}  onClick={() => setMenuOpen(false)}>Dashboard</Link>
                        <Link to="/transactions" className={navClass('/transactions')}           onClick={() => setMenuOpen(false)}>Transactions</Link>
                        <Link to="/accounts"     className={navClass('/accounts')}              onClick={() => setMenuOpen(false)}>Accounts</Link>
                        <Link to="/categories"   className={navClass('/categories')}            onClick={() => setMenuOpen(false)}>Categories</Link>
                        <Link to="/schedules"    className={navClass('/schedules')}             onClick={() => setMenuOpen(false)}>Schedules</Link>

                        {/* Divider + user identity + account actions */}
                        <div className="border-t border-ocean-700 mt-2 pt-3 flex flex-col gap-2">
                            {userEmail && (
                                <span className="text-sm text-slate-400 px-3">{userEmail}</span>
                            )}
                            <Link
                                to="/change-password"
                                className="px-3 py-1.5 text-sm rounded border border-ocean-600 text-slate-300 hover:text-white hover:border-sky-500 transition-colors"
                                onClick={() => setMenuOpen(false)}
                            >
                                Change Password
                            </Link>
                            <button
                                onClick={() => { handleLogout(); setMenuOpen(false) }}
                                className="px-3 py-1.5 text-sm rounded border border-ocean-600 text-slate-300 hover:text-white hover:border-sky-500 transition-colors cursor-pointer text-left"
                            >
                                Log out
                            </button>
                        </div>

                    </div>
                )}

            </nav>

            {/* ── Page content ───────────────────────────────────────────── */}
            {/* px-4 on mobile, wider padding on larger screens */}
            <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
                {children}
            </main>

        </div>
    )
}

export default Layout
