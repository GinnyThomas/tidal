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

function mockGets({ connections = [makeConnection()] as unknown[], institutions = INSTITUTIONS } = {}) {
    vi.mocked(axios.get).mockImplementation((url: string) => {
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

    it('shows a message when bank feeds are not configured on the server', async () => {
        vi.mocked(axios.get).mockImplementation((url: string) => {
            if (url.endsWith('/bank-feeds/institutions')) return Promise.reject({ response: { status: 503 } })
            if (url.endsWith('/bank-feeds/connections')) return Promise.resolve({ data: [] })
            return Promise.resolve({ data: ACCOUNTS })
        })
        renderPage()
        expect(await screen.findByText(/not set up on this server/i)).toBeInTheDocument()
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
})
