// pages/BankFeedsPage.test.tsx

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import BankFeedsPage from './BankFeedsPage'

vi.mock('axios')

const makeConnection = (overrides = {}) => ({
    id: 'conn-1',
    provider: 'enable_banking',
    institution_name: 'Monzo',
    institution_country: 'GB',
    status: 'active',
    valid_until: '2027-01-15T00:00:00Z',
    accounts: [{
        id: 'link-1',
        name: 'Current Account',
        currency: 'GBP',
        iban_last4: '5555',
        account_id: null,
        last_synced_at: null,
        last_sync_attempt_at: null,
        last_sync_error: null,
    }],
    ...overrides,
})

const ACCOUNTS = [
    { id: 'acc-gbp', name: 'Monzo Current', currency: 'GBP' },
    { id: 'acc-eur', name: 'Santander', currency: 'EUR' },
]

const INSTITUTIONS = [
    { name: 'Monzo', country: 'GB', logo: null, max_consent_days: 90 },
    { name: 'Virgin Money', country: 'GB', logo: null, max_consent_days: 90 },
]

const ENABLE_BANKING = { name: 'enable_banking', display_name: 'Enable Banking', flow: 'consent' }
const BANKSYNC = { name: 'banksync', display_name: 'BankSync', flow: 'pre_connected' }

function mockGets({
    connections = [makeConnection()] as unknown[],
    institutions = INSTITUTIONS,
    providers = [ENABLE_BANKING] as unknown[],
} = {}) {
    vi.mocked(axios.get).mockImplementation((url: string) => {
        // Fresh objects per call, like a real response: identity must not matter.
        if (url.endsWith('/bank-feeds/providers')) return Promise.resolve({ data: structuredClone(providers) })
        if (url.endsWith('/bank-feeds/connections')) return Promise.resolve({ data: connections })
        if (url.endsWith('/bank-feeds/institutions')) return Promise.resolve({ data: institutions })
        if (url.endsWith('/api/v1/accounts')) return Promise.resolve({ data: ACCOUNTS })
        return Promise.reject(new Error(`unexpected GET ${url}`))
    })
}

const renderPage = () => render(<MemoryRouter><BankFeedsPage /></MemoryRouter>)

describe('BankFeedsPage', () => {
    beforeEach(() => {
        localStorage.setItem('access_token', 'fake-token')
    })

    afterEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
        vi.unstubAllGlobals()
    })

    it('shows a loading indicator while fetching', () => {
        vi.mocked(axios.get).mockReturnValue(new Promise<never>(() => {}))
        renderPage()
        expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })

    it('shows an empty state when no banks are connected', async () => {
        mockGets({ connections: [] })
        renderPage()
        expect(await screen.findByText(/no banks connected yet/i)).toBeInTheDocument()
    })

    it('shows a message when no bank feed provider is available', async () => {
        mockGets({ connections: [], providers: [] })
        renderPage()
        expect(await screen.findByText(/not set up on this server/i)).toBeInTheDocument()
        expect(axios.get).not.toHaveBeenCalledWith(
            expect.stringContaining('/bank-feeds/institutions'), expect.anything(),
        )
    })

    it('lists connected banks with their accounts', async () => {
        mockGets()
        renderPage()
        expect(await screen.findByRole('heading', { name: /monzo/i })).toBeInTheDocument()
        expect(screen.getByText('Current Account')).toBeInTheDocument()
        expect(screen.getByText(/•••• 5555/)).toBeInTheDocument()
    })

    it('marks an expired connection', async () => {
        mockGets({ connections: [makeConnection({ status: 'expired' })] })
        renderPage()
        expect(await screen.findByText(/consent expired/i)).toBeInTheDocument()
    })

    // --- Connecting ---

    it('loads banks for the chosen country', async () => {
        mockGets()
        renderPage()
        await screen.findByRole('heading', { name: /monzo/i })
        await userEvent.selectOptions(screen.getByLabelText(/country/i), 'ES')
        expect(axios.get).toHaveBeenCalledWith(
            expect.stringContaining('/api/v1/bank-feeds/institutions'),
            expect.objectContaining({ params: { country: 'ES' } }),
        )
    })

    it('starts a connection and sends the browser to the bank', async () => {
        mockGets()
        const assign = vi.fn()
        vi.stubGlobal('location', { ...window.location, assign })
        vi.mocked(axios.post).mockResolvedValueOnce({
            data: { connection_id: 'conn-2', auth_url: 'https://bank.example/consent' },
        })
        renderPage()
        await screen.findByRole('option', { name: 'Virgin Money' })
        await userEvent.selectOptions(screen.getByLabelText(/^bank$/i), 'Virgin Money')
        await userEvent.click(screen.getByRole('button', { name: /connect/i }))

        expect(axios.post).toHaveBeenCalledWith(
            expect.stringContaining('/api/v1/bank-feeds/connections'),
            { institution: 'Virgin Money', country: 'GB' },
            expect.anything(),
        )
        expect(assign).toHaveBeenCalledWith('https://bank.example/consent')
    })

    // --- Linking ---

    it('offers only Tidal accounts in the same currency', async () => {
        mockGets()
        renderPage()
        const select = await screen.findByLabelText(/link current account to/i)
        expect(within(select).getByRole('option', { name: 'Monzo Current' })).toBeInTheDocument()
        expect(within(select).queryByRole('option', { name: 'Santander' })).not.toBeInTheDocument()
    })

    it('links a bank account to the chosen Tidal account', async () => {
        mockGets()
        vi.mocked(axios.put).mockResolvedValueOnce({
            data: { ...makeConnection().accounts[0], account_id: 'acc-gbp' },
        })
        renderPage()
        await userEvent.selectOptions(await screen.findByLabelText(/link current account to/i), 'acc-gbp')
        expect(axios.put).toHaveBeenCalledWith(
            expect.stringContaining('/api/v1/bank-feeds/links/link-1'),
            { account_id: 'acc-gbp' },
            expect.anything(),
        )
    })

    // --- Syncing ---

    it('disables Sync now until the account is linked', async () => {
        mockGets()
        renderPage()
        expect(await screen.findByRole('button', { name: /sync now/i })).toBeDisabled()
    })

    it('syncs a linked account and reports what was imported', async () => {
        const linked = makeConnection({
            accounts: [{ ...makeConnection().accounts[0], account_id: 'acc-gbp' }],
        })
        mockGets({ connections: [linked] })
        vi.mocked(axios.post).mockResolvedValueOnce({
            data: { created: 3, skipped_duplicates: 2, skipped_rows: [] },
        })
        renderPage()
        await userEvent.click(await screen.findByRole('button', { name: /sync now/i }))

        expect(axios.post).toHaveBeenCalledWith(
            expect.stringContaining('/api/v1/bank-feeds/links/link-1/sync'),
            {},
            expect.anything(),
        )
        expect(await screen.findByText(/3 new, 2 already imported/i)).toBeInTheDocument()
    })

    it('shows an error when sync fails', async () => {
        const linked = makeConnection({
            accounts: [{ ...makeConnection().accounts[0], account_id: 'acc-gbp' }],
        })
        mockGets({ connections: [linked] })
        vi.mocked(axios.post).mockRejectedValueOnce({ response: { status: 502, data: { detail: 'The bank feed provider returned an error.' } } })
        renderPage()
        await userEvent.click(await screen.findByRole('button', { name: /sync now/i }))
        expect(await screen.findByText(/provider returned an error/i)).toBeInTheDocument()
    })

    it('shows why the last sync failed under the account', async () => {
        // e.g. the daily sync ran overnight and the BankSync key had expired.
        const failed = makeConnection({
            accounts: [{
                ...makeConnection().accounts[0],
                account_id: 'acc-gbp',
                last_sync_attempt_at: '2026-11-25T06:00:00Z',
                last_sync_error: "The bank feed provider rejected Tidal's API key.",
            }],
        })
        mockGets({ connections: [failed] })
        renderPage()
        expect(await screen.findByText(/last sync failed: the bank feed provider rejected tidal's api key/i))
            .toBeInTheDocument()
    })

    it('clears the last sync error after a successful sync', async () => {
        const failed = makeConnection({
            accounts: [{
                ...makeConnection().accounts[0],
                account_id: 'acc-gbp',
                last_sync_error: 'The bank feed provider returned an error (HTTP 500).',
            }],
        })
        mockGets({ connections: [failed] })
        vi.mocked(axios.post).mockResolvedValueOnce({
            data: { created: 1, skipped_duplicates: 0, skipped_rows: [] },
        })
        renderPage()
        await userEvent.click(await screen.findByRole('button', { name: /sync now/i }))

        expect(await screen.findByText(/1 new, 0 already imported/i)).toBeInTheDocument()
        expect(screen.queryByText(/last sync failed/i)).not.toBeInTheDocument()
    })

    it('shows only the new error when a manual sync fails again', async () => {
        const failed = makeConnection({
            accounts: [{
                ...makeConnection().accounts[0],
                account_id: 'acc-gbp',
                last_sync_error: 'The bank feed provider returned an error (HTTP 500).',
            }],
        })
        mockGets({ connections: [failed] })
        vi.mocked(axios.post).mockRejectedValueOnce({ response: { status: 502, data: { detail: 'The bank feed provider returned an error. Please try again.' } } })
        renderPage()
        await userEvent.click(await screen.findByRole('button', { name: /sync now/i }))

        expect(await screen.findByText(/please try again/i)).toBeInTheDocument()
        expect(screen.queryByText(/last sync failed/i)).not.toBeInTheDocument()
    })

    it('disables Sync now when the consent has expired', async () => {
        const expired = makeConnection({
            status: 'expired',
            accounts: [{ ...makeConnection().accounts[0], account_id: 'acc-gbp' }],
        })
        mockGets({ connections: [expired] })
        renderPage()
        expect(await screen.findByRole('button', { name: /sync now/i })).toBeDisabled()
    })

    // --- Removing ---

    it('removes a connection after confirmation', async () => {
        mockGets()
        vi.stubGlobal('confirm', vi.fn(() => true))
        vi.mocked(axios.delete).mockResolvedValueOnce({})
        renderPage()
        await userEvent.click(await screen.findByRole('button', { name: /remove/i }))
        expect(axios.delete).toHaveBeenCalledWith(
            expect.stringContaining('/api/v1/bank-feeds/connections/conn-1'),
            expect.anything(),
        )
    })

    it('keeps the chosen bank when a connection is removed', async () => {
        mockGets()
        vi.stubGlobal('confirm', vi.fn(() => true))
        vi.mocked(axios.delete).mockResolvedValueOnce({})
        renderPage()
        await screen.findByRole('option', { name: 'Virgin Money' })
        await userEvent.selectOptions(screen.getByLabelText(/^bank$/i), 'Virgin Money')

        await userEvent.click(screen.getByRole('button', { name: /remove/i }))
        await vi.waitFor(() => expect(vi.mocked(axios.get).mock.calls.length).toBeGreaterThanOrEqual(7))
        // Let the reload's re-render and effects run before checking.
        await new Promise(resolve => setTimeout(resolve, 50))

        // The reload after Remove fetches providers again, but the consent
        // provider is the same, so the bank list isn't reloaded or reset.
        expect(screen.getByLabelText(/^bank$/i)).toHaveValue('Virgin Money')
        const institutionCalls = vi.mocked(axios.get).mock.calls
            .filter(([url]) => String(url).endsWith('/bank-feeds/institutions'))
        expect(institutionCalls).toHaveLength(1)
    })

    it('still lists connections when the providers request fails', async () => {
        mockGets()
        const fallback = vi.mocked(axios.get).getMockImplementation()!
        vi.mocked(axios.get).mockImplementation((url: string, config?: unknown) =>
            url.endsWith('/bank-feeds/providers')
                ? Promise.reject(new Error('404'))
                : fallback(url, config),
        )
        renderPage()
        expect(await screen.findByRole('heading', { name: /monzo/i })).toBeInTheDocument()
        expect(screen.getByText(/could not load the bank feed providers/i)).toBeInTheDocument()
        expect(screen.queryByText(/not set up on this server/i)).not.toBeInTheDocument()
    })

    // --- Pre-connected providers (BankSync) ---

    describe('with BankSync', () => {
        const banksyncConnection = (overrides = {}) => makeConnection({
            id: 'conn-bs', provider: 'banksync', valid_until: '2027-05-22T17:35:17Z', ...overrides,
        })

        it('offers a refresh instead of the bank picker when only BankSync is available', async () => {
            mockGets({ connections: [], providers: [BANKSYNC] })
            renderPage()
            expect(await screen.findByRole('button', { name: /refresh from banksync/i })).toBeInTheDocument()
            expect(screen.queryByRole('heading', { name: /connect a bank/i })).not.toBeInTheDocument()
            expect(screen.queryByText(/not set up on this server/i)).not.toBeInTheDocument()
        })

        it('says linked accounts sync automatically every morning', async () => {
            mockGets({ connections: [], providers: [BANKSYNC] })
            renderPage()
            expect(await screen.findByText(/synced automatically every morning/i)).toBeInTheDocument()
        })

        it('shows both when both providers are available', async () => {
            mockGets({ connections: [], providers: [ENABLE_BANKING, BANKSYNC] })
            renderPage()
            expect(await screen.findByRole('button', { name: /refresh from banksync/i })).toBeInTheDocument()
            expect(screen.getByRole('heading', { name: /connect a bank/i })).toBeInTheDocument()
        })

        it('refreshes from BankSync and shows its banks', async () => {
            mockGets({ connections: [], providers: [BANKSYNC] })
            vi.mocked(axios.post).mockResolvedValueOnce({ data: [banksyncConnection()] })
            renderPage()
            await userEvent.click(await screen.findByRole('button', { name: /refresh from banksync/i }))

            expect(axios.post).toHaveBeenCalledWith(
                expect.stringContaining('/api/v1/bank-feeds/providers/banksync/refresh'),
                {},
                expect.anything(),
            )
            expect(await screen.findByRole('heading', { name: /monzo/i })).toBeInTheDocument()
        })

        it('shows the reason when a refresh fails', async () => {
            mockGets({ connections: [], providers: [BANKSYNC] })
            vi.mocked(axios.post).mockRejectedValueOnce({
                response: { status: 429, data: { detail: 'The bank feed provider is busy. Try again in 42 seconds.' } },
            })
            renderPage()
            await userEvent.click(await screen.findByRole('button', { name: /refresh from banksync/i }))
            expect(await screen.findByText(/try again in 42 seconds/i)).toBeInTheDocument()
        })

        it('does not offer Remove for a BankSync bank', async () => {
            // Refresh would bring it straight back; banks are removed in BankSync.
            mockGets({ connections: [banksyncConnection()], providers: [BANKSYNC] })
            renderPage()
            await screen.findByRole('heading', { name: /monzo/i })
            expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
        })

        it('tells you to reconnect in BankSync when its consent has expired', async () => {
            mockGets({ connections: [banksyncConnection({ status: 'expired' })], providers: [BANKSYNC] })
            renderPage()
            expect(await screen.findByText(/reconnect this bank in banksync/i)).toBeInTheDocument()
        })
    })
})
