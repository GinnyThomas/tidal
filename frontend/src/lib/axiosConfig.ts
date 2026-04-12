// lib/axiosConfig.ts
//
// Purpose: Global axios interceptors for token expiry and silent refresh.
//
// Two interceptors:
//   1. Response success: checks if JWT is nearing expiry (< 15 min),
//      silently refreshes via POST /api/v1/auth/refresh.
//   2. Response error: on 401, redirects to /login.
//
// Guards:
//   - isRefreshing flag prevents multiple simultaneous refresh calls
//   - Auth endpoints excluded to avoid infinite loops
//
// Initialisation:
//   Import this file once in main.tsx — the import itself registers interceptors.

import axios from 'axios'
import { getApiBaseUrl } from './api'

let isRefreshing = false

/**
 * Decode a JWT payload without verifying the signature.
 * Returns null if the token is malformed.
 */
export function decodeJwtPayload(token: string): { exp?: number } | null {
    try {
        const parts = token.split('.')
        if (parts.length !== 3) return null
        const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
        return JSON.parse(json)
    } catch {
        return null
    }
}

/** Check if token needs refresh (< 15 min remaining) and trigger it. */
export function checkAndRefreshToken(): void {
    const token = localStorage.getItem('access_token')
    if (!token || isRefreshing) return

    const payload = decodeJwtPayload(token)
    if (!payload?.exp) return

    const secondsUntilExpiry = payload.exp - Date.now() / 1000
    if (secondsUntilExpiry < 900) {
        isRefreshing = true
        axios.post(`${getApiBaseUrl()}/api/v1/auth/refresh`, null, {
            headers: { Authorization: `Bearer ${token}` },
        }).then(res => {
            const newToken = res.data?.access_token
            if (newToken) localStorage.setItem('access_token', newToken)
        }).catch(() => {
            // Silent — the 401 handler catches expired tokens
        }).finally(() => {
            isRefreshing = false
        })
    }
}

// --- Register interceptors ---

// Success: trigger silent refresh on non-auth responses
axios.interceptors.response.use(
    (response) => {
        const url: string = response.config?.url ?? ''
        if (!url.includes('/auth/')) {
            checkAndRefreshToken()
        }
        return response
    },
    // Error: redirect on 401
    (error) => {
        const url: string = error.config?.url ?? ''
        const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/register')
        const hasToken =
            error.config?.headers?.Authorization ||
            localStorage.getItem('access_token')

        if (error.response?.status === 401 && !isAuthEndpoint && hasToken) {
            localStorage.removeItem('access_token')
            localStorage.removeItem('user_email')
            window.location.href = '/login'
        }
        return Promise.reject(error)
    }
)
