// components/LegalLayout.tsx
//
// Shared shell for the public Privacy Policy and Terms of Use pages.
// Standalone (no Layout, no login): Enable Banking and other third parties
// link to these URLs, so they must render for logged-out visitors.

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export const CONTACT_EMAIL = 'ginnynjon@gmail.com'
export const LAST_UPDATED = '29 October 2026'

export function ContactLink() {
    return (
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-sky-400 hover:text-sky-300 transition-colors">
            {CONTACT_EMAIL}
        </a>
    )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
            {children}
        </section>
    )
}

type LegalLayoutProps = {
    title: string
    otherPage: { to: string; label: string }
    children: ReactNode
}

function LegalLayout({ title, otherPage, children }: LegalLayoutProps) {
    return (
        <div className="min-h-screen bg-ocean-900 px-4 py-12">
            <div className="max-w-3xl mx-auto bg-ocean-800 border border-ocean-700 rounded-xl p-8 shadow-2xl">
                <p className="text-2xl font-bold mb-6">
                    <span aria-hidden="true">🌊 </span>
                    <span className="text-sky-500">Tidal</span>
                </p>
                <h1 className="text-3xl font-bold text-slate-100">{title}</h1>
                <p className="text-slate-400 text-sm mt-1 mb-8">Last updated {LAST_UPDATED}</p>

                <div className="space-y-8 text-slate-300 leading-relaxed">{children}</div>

                <p className="text-sm text-slate-400 mt-10 pt-6 border-t border-ocean-700 flex gap-4">
                    <Link to={otherPage.to} className="text-sky-400 hover:text-sky-300 transition-colors">
                        {otherPage.label}
                    </Link>
                    <Link to="/login" className="text-sky-400 hover:text-sky-300 transition-colors">
                        Log in
                    </Link>
                </p>
            </div>
        </div>
    )
}

export default LegalLayout
