// lib/axiosConfig.test.ts
//
// Purpose: Tests for the JWT decode and refresh logic.
//
// Strategy: Test the exported helper functions directly rather than
// interceptor side effects, to avoid polluting the global axios state
// for other test files.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import axios from 'axios'
import { decodeJwtPayload, checkAndRefreshToken } from './axiosConfig'
import { getApiBaseUrl } from './api'

/**
 * Build a fake JWT with a specific exp timestamp.
 */
function fakeJwt(expUnix: number): string {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const payload = btoa(JSON.stringify({ sub: 'user-123', exp: expUnix }))
    return `${header}.${payload}.fakesignature`
}

describe('axiosConfig', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    afterEach(() => {
        localStorage.clear()
        vi.restoreAllMocks()
    })

    // =========================================================================
    // JWT decode
    // =========================================================================

    it('decodeJwtPayload returns exp from a valid JWT', () => {
        const token = fakeJwt(1700000000)
        const payload = decodeJwtPayload(token)
        expect(payload?.exp).toBe(1700000000)
    })

    it('decodeJwtPayload returns null for malformed tokens', () => {
        expect(decodeJwtPayload('not-a-jwt')).toBeNull()
        expect(decodeJwtPayload('')).toBeNull()
    })

    // =========================================================================
    // Token refresh logic
    // =========================================================================

    it('does not call refresh when token has > 15 minutes remaining', () => {
        const token = fakeJwt(Date.now() / 1000 + 3600) // 60 min remaining
        localStorage.setItem('access_token', token)

        const postSpy = vi.spyOn(axios, 'post')

        checkAndRefreshToken()

        const refreshCalls = postSpy.mock.calls.filter(
            ([url]) => String(url).includes('/auth/refresh')
        )
        expect(refreshCalls.length).toBe(0)
    })

    it('calls refresh when token has < 15 minutes remaining', async () => {
        const oldToken = fakeJwt(Date.now() / 1000 + 300) // 5 min remaining
        localStorage.setItem('access_token', oldToken)

        const newToken = fakeJwt(Date.now() / 1000 + 3600)

        const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
            data: { access_token: newToken, token_type: 'bearer' },
        })

        checkAndRefreshToken()

        // Wait for the async refresh to complete
        await new Promise(r => setTimeout(r, 50))

        const refreshCalls = postSpy.mock.calls.filter(
            ([url]) => String(url).includes('/auth/refresh')
        )
        expect(refreshCalls.length).toBe(1)
        expect(refreshCalls[0][0]).toBe(`${getApiBaseUrl()}/api/v1/auth/refresh`)

        // New token should be stored
        expect(localStorage.getItem('access_token')).toBe(newToken)
    })

    it('does not call refresh when no token in localStorage', () => {
        const postSpy = vi.spyOn(axios, 'post')

        checkAndRefreshToken()

        expect(postSpy).not.toHaveBeenCalled()
    })
})
