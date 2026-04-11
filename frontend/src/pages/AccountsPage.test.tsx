// pages/AccountsPage.test.tsx
//
// Purpose: Tests for AccountsPage — the main accounts list view.
//
// Test strategy:
//   We test the four render states (loading, error, empty, list), the
//   Add Account toggle, the integration loop where submitting the form
//   triggers a re-fetch, account edit mode (pre-population + PUT), and
//   the account name drill-down link to /transactions?account_id=xxx.
//
// axios is mocked globally so no real HTTP requests are made.
// localStorage holds the fake JWT token each test needs.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import axios from 'axios'
import AccountsPage from './AccountsPage'
import { getApiBaseUrl } from '../lib/api'

vi.mock('axios')

// A minimal account object that matches the AccountResponse shape from the API.
const makeAccount = (overrides = {}) => ({
    id: 'abc-123',
    name: 'Nationwide Current',
    account_type: 'checking',
    currency: 'GBP',
    current_balance: '1500.00',
    institution: 'Nationwide',
    note: null,
    is_active: true,
    ...overrides,
})

describe('AccountsPage', () => {
    beforeEach(() => {
        // Every test needs a token — the component reads it from localStorage
        // to build the Authorization header for the accounts fetch.
        localStorage.setItem('access_token', 'fake-token')
    })

    afterEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    // =========================================================================
    // Render states
    // =========================================================================

    it('shows a loading indicator while the fetch is in progress', () => {
        // mockReturnValueOnce (not mockResolvedValueOnce) lets us hand back
        // a promise that never settles — the component stays in loading state.
        vi.mocked(axios.get).mockReturnValueOnce(new Promise<never>(() => {}))

        render(<MemoryRouter><AccountsPage /></MemoryRouter>)

        expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })

    it('renders a list of accounts after a successful fetch', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: [makeAccount()],
        })

        render(<MemoryRouter><AccountsPage /></MemoryRouter>)

        // findBy* waits for the element to appear (resolves after the async fetch)
        expect(await screen.findByText('Nationwide Current')).toBeInTheDocument()
        expect(screen.getByText(/checking/i)).toBeInTheDocument()
        expect(screen.getByText(/GBP/i)).toBeInTheDocument()
        expect(screen.getByText(/1500.00/)).toBeInTheDocument()
    })

    it('shows an empty-state message when the user has no accounts', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [] })

        render(<MemoryRouter><AccountsPage /></MemoryRouter>)

        expect(await screen.findByText(/no accounts yet/i)).toBeInTheDocument()
    })

    it('shows an error message when the fetch fails', async () => {
        vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network error'))

        render(<MemoryRouter><AccountsPage /></MemoryRouter>)

        expect(await screen.findByText(/could not load/i)).toBeInTheDocument()
    })

    // =========================================================================
    // Add Account button
    // =========================================================================

    it('shows an Add Account button once accounts have loaded', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [] })

        render(<MemoryRouter><AccountsPage /></MemoryRouter>)

        // Button is absent during loading, present after
        expect(await screen.findByRole('button', { name: /add account/i })).toBeInTheDocument()
    })

    it('shows the AddAccountForm when Add Account is clicked', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [] })

        render(<MemoryRouter><AccountsPage /></MemoryRouter>)

        await userEvent.click(await screen.findByRole('button', { name: /add account/i }))

        // The form's first field should now be visible
        expect(screen.getByLabelText(/account name/i)).toBeInTheDocument()
    })

    it('hides the AddAccountForm when Add Account is clicked a second time', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [] })

        render(<MemoryRouter><AccountsPage /></MemoryRouter>)

        const button = await screen.findByRole('button', { name: /add account/i })
        await userEvent.click(button) // show
        await userEvent.click(button) // hide

        expect(screen.queryByLabelText(/account name/i)).not.toBeInTheDocument()
    })

    // =========================================================================
    // Integration: form submission triggers re-fetch
    // =========================================================================

    it('re-fetches the accounts list and hides the form after onAccountAdded fires', async () => {
        // First call: empty list (initial load)
        // Second call: one account (after the form submits)
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [makeAccount({ name: 'New Savings', account_type: 'savings' })] })

        // The form's POST request
        vi.mocked(axios.post).mockResolvedValueOnce({ data: { id: 'abc-123' } })

        render(<MemoryRouter><AccountsPage /></MemoryRouter>)

        // Wait for the empty state
        await screen.findByText(/no accounts yet/i)

        // Open the form
        await userEvent.click(screen.getByRole('button', { name: /add account/i }))

        // Fill in the only required field and submit
        await userEvent.type(screen.getByLabelText(/account name/i), 'New Savings')
        await userEvent.click(screen.getByRole('button', { name: /save account/i }))

        // The re-fetch should resolve and the new account should appear
        expect(await screen.findByText('New Savings')).toBeInTheDocument()

        // The form should be hidden after a successful submit
        expect(screen.queryByLabelText(/account name/i)).not.toBeInTheDocument()
    })

    // =========================================================================
    // Edit account
    // =========================================================================

    it('shows an Edit button on each account card', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: [makeAccount()] })

        render(<MemoryRouter><AccountsPage /></MemoryRouter>)

        await screen.findByText('Nationwide Current')
        expect(screen.getByRole('button', { name: /^edit /i })).toBeInTheDocument()
    })

    it('clicking Edit opens AddAccountForm pre-populated with the account values', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: [makeAccount({ name: 'My Savings', account_type: 'savings', currency: 'EUR', current_balance: '3000.00', institution: 'Revolut' })],
        })

        render(<MemoryRouter><AccountsPage /></MemoryRouter>)

        await screen.findByText('My Savings')
        await userEvent.click(screen.getByRole('button', { name: /^edit /i }))

        // The form should be pre-populated with the account's existing values
        expect(screen.getByLabelText(/account name/i)).toHaveValue('My Savings')
        expect(screen.getByLabelText(/account type/i)).toHaveValue('savings')
        expect(screen.getByLabelText(/^currency$/i)).toHaveValue('EUR')
        expect(screen.getByLabelText(/current balance/i)).toHaveValue(3000)
        expect(screen.getByLabelText(/institution/i)).toHaveValue('Revolut')
        // Heading and button reflect edit mode
        expect(screen.getByText('Edit Account')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /update account/i })).toBeInTheDocument()
    })

    it('submits PUT to update the account in edit mode', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: [makeAccount({ id: 'acc-001', name: 'Current' })] })
            .mockResolvedValueOnce({ data: [makeAccount({ id: 'acc-001', name: 'Current Updated' })] })
        vi.mocked(axios.put).mockResolvedValueOnce({ data: {} })

        render(<MemoryRouter><AccountsPage /></MemoryRouter>)

        await screen.findByText('Current')
        await userEvent.click(screen.getByRole('button', { name: /^edit /i }))
        await userEvent.click(screen.getByRole('button', { name: /update account/i }))

        await waitFor(() => {
            expect(vi.mocked(axios.put)).toHaveBeenCalledWith(
                `${getApiBaseUrl()}/api/v1/accounts/acc-001`,
                expect.objectContaining({ name: 'Current' }),
                expect.objectContaining({ headers: { Authorization: 'Bearer fake-token' } })
            )
        })

        // After re-fetch the updated name appears and the form is hidden
        expect(await screen.findByText('Current Updated')).toBeInTheDocument()
        expect(screen.queryByLabelText(/account name/i)).not.toBeInTheDocument()
    })

    // =========================================================================
    // Account drill-down link
    // =========================================================================

    it('account name is a link to the filtered transactions view', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: [makeAccount({ id: 'acc-001', name: 'Nationwide Current' })],
        })

        render(<MemoryRouter><AccountsPage /></MemoryRouter>)

        await screen.findByText('Nationwide Current')

        const link = screen.getByRole('link', { name: 'Nationwide Current' })
        expect(link).toHaveAttribute('href', expect.stringContaining('/transactions?account_id=acc-001'))
    })

    // =========================================================================
    // Clickable rows
    // =========================================================================

    it('clicking an account card opens the edit form', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: [makeAccount({ name: 'Click Test' })],
        })

        render(<MemoryRouter><AccountsPage /></MemoryRouter>)

        await screen.findByText('Click Test')
        // Click the card (has aria-label="Click to edit")
        await userEvent.click(screen.getByLabelText('Click to edit'))

        expect(screen.getByText('Edit Account')).toBeInTheDocument()
    })
})
