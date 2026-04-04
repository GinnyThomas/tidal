// lib/api.ts
//
// Purpose: Centralised API configuration for all HTTP calls.
//
// Why centralise the base URL?
//   Every fetch in the app needs the backend URL. If we read
//   import.meta.env.VITE_API_URL in each file separately, a misconfigured
//   environment (missing var, accidental trailing slash) causes subtle bugs
//   across many files. One helper, one place to fix.
//
// What getApiBaseUrl() does:
//   1. Reads VITE_API_URL from the Vite environment.
//   2. Trims any accidental trailing slash — so both
//      "http://localhost:8000" and "http://localhost:8000/" produce
//      the same output and won't break URL construction.
//   3. Throws immediately with a clear message if the variable is missing
//      or empty — fail loud at startup rather than sending requests to
//      an empty string and getting confusing network errors.
//
// Usage:
//   import { getApiBaseUrl } from '../lib/api'
//   const url = `${getApiBaseUrl()}/api/v1/accounts`

export function getApiBaseUrl(): string {
    const raw = import.meta.env.VITE_API_URL
    if (!raw || raw.trim() === '') {
        throw new Error(
            'VITE_API_URL is not set. ' +
            'Copy frontend/.env.example to frontend/.env and set the value.'
        )
    }
    return raw.trim().replace(/\/$/, '')
}
