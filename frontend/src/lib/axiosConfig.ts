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
//   On any 401 response: clears access_token and user_email from localStorage,
//   then redirects to /login. This covers both expired JWTs and revoked tokens.
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
        if (error.response?.status === 401) {
            localStorage.removeItem('access_token')
            localStorage.removeItem('user_email')
            window.location.href = '/login'
        }
        return Promise.reject(error)
    }
)
