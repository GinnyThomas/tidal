import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import axios from 'axios'
import { getApiBaseUrl } from '../lib/api'

function ProtectedRoute({ children }: { children: ReactNode }) {
    const token = localStorage.getItem('access_token')
    const [catchUpCount, setCatchUpCount] = useState(0)
    const [showToast, setShowToast] = useState(false)

    useEffect(() => {
        if (!token) return

        const today = new Date().toISOString().split('T')[0]
        const lastCatchUp = localStorage.getItem('tidal_last_catchup')
        if (lastCatchUp === today) return

        axios.post(
            `${getApiBaseUrl()}/api/v1/schedules/catch-up`,
            {},
            { headers: { Authorization: `Bearer ${token}` } }
        ).then(res => {
            localStorage.setItem('tidal_last_catchup', today)
            if (res.data.count > 0) {
                setCatchUpCount(res.data.count)
                setShowToast(true)
            }
        }).catch(() => {
            // Don't block the app; don't update localStorage so it retries next load
        })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    if (!token) {
        return <Navigate to="/login" replace />
    }

    return (
        <>
            {showToast && (
                <div className="fixed top-4 right-4 z-50 bg-ocean-800 border border-teal-500/30 rounded-lg shadow-lg px-4 py-3 flex items-center gap-3" role="status" aria-label="Catch-up notification">
                    <span className="text-sm text-slate-200">
                        Created {catchUpCount} pending transaction{catchUpCount !== 1 ? 's' : ''} from your schedules.
                    </span>
                    <Link
                        to="/transactions?status=pending"
                        className="text-sm text-teal-400 hover:text-teal-300 font-medium whitespace-nowrap"
                        onClick={() => setShowToast(false)}
                    >
                        View
                    </Link>
                    <button
                        onClick={() => setShowToast(false)}
                        className="text-slate-400 hover:text-white text-sm cursor-pointer leading-none"
                        aria-label="Dismiss notification"
                    >
                        ×
                    </button>
                </div>
            )}
            {children}
        </>
    )
}

export default ProtectedRoute
