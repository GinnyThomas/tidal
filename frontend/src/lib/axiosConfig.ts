// lib/axiosConfig.ts
//
// Purpose: Global axios interceptor that handles token expiry.
//
// Why an interceptor?
//   Without this, a 401 response leaves the user stuck — their stored token
//   is no longer valid but they are not redirected to /login. The interceptor
//   fires on every 401 across the entire app without per-request boilerplate.
//
// What it does:
//   On any 401 response, redirects to /login — but only when the failing
//   request is NOT an auth endpoint (/auth/login or /auth/register) AND
//   either carries an Authorization header or has an access_token in
//   localStorage. This prevents redirect loops on deliberate login failures
//   (wrong password) while still catching expired/revoked tokens on all
//   protected routes.
//
// Initialisation:
//   Import this file once in main.tsx — importing it executes the side effect
//   (interceptor registration) exactly once at app startup. No exported function
//   needed; the import itself is the call.

import axios from 'axios'

axios.interceptors.response.use(
    // Pass through successful responses unchanged
    (response) => response,
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
