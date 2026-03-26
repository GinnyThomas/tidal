// components/AddAccountForm.tsx
//
// Purpose: Form for creating a new account.
//
// Props:
//   onAccountAdded — called by the parent (AccountsPage) after a successful
//                    submit so it can re-fetch the accounts list and hide
//                    this form. The parent owns "what happens next".
//
// Design decisions:
//   - All fields are controlled inputs (value + onChange) — React owns the
//     state, not the DOM. This makes testing straightforward and prevents
//     stale reads.
//   - account_type uses a <select> with the six valid values from the backend
//     AccountType enum. No free-text entry, so no validation needed here.
//   - Optional string fields send null when empty. The backend schema has
//     Optional[str] = None for institution and note, so null is correct.
//   - current_balance is type="number" so the browser enforces numeric input.
//     We pass the string value of the input; Pydantic on the backend coerces
//     it to Decimal.
//   - JWT comes from localStorage — same pattern as LoginPage.

import axios from 'axios'
import { useState } from 'react'
import type { SyntheticEvent } from 'react'


type Props = {
    onAccountAdded: () => void
}

function AddAccountForm({ onAccountAdded }: Props) {
    const [name, setName] = useState('')
    const [accountType, setAccountType] = useState('checking')
    const [currency, setCurrency] = useState('GBP')
    const [currentBalance, setCurrentBalance] = useState('0')
    const [institution, setInstitution] = useState('')
    const [note, setNote] = useState('')
    const [error, setError] = useState<string | null>(null)

    const handleSubmit = async (e: SyntheticEvent) => {
        e.preventDefault()
        setError(null)

        const token = localStorage.getItem('access_token')

        try {
            await axios.post(
                'http://localhost:8000/api/v1/accounts',
                {
                    name,
                    account_type: accountType,
                    currency,
                    current_balance: currentBalance,
                    // Send null for empty optional strings — the backend expects
                    // Optional[str] = None, not an empty string.
                    institution: institution || null,
                    note: note || null,
                },
                {
                    headers: { Authorization: `Bearer ${token}` },
                }
            )
            // Tell the parent the account was created.
            // The parent decides what to do next (re-fetch, hide form, etc.).
            onAccountAdded()
        } catch {
            setError('Could not create account. Please try again.')
        }
    }

    return (
        <form onSubmit={handleSubmit}>
            <label htmlFor="name">Account Name</label>
            <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
            />

            {/* account_type is a select — the browser ensures only valid values
                can be chosen, and the initial value matches the backend default */}
            <label htmlFor="accountType">Account Type</label>
            <select
                id="accountType"
                value={accountType}
                onChange={(e) => setAccountType(e.target.value)}
            >
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
                <option value="credit_card">Credit Card</option>
                <option value="cash">Cash</option>
                <option value="mortgage">Mortgage</option>
                <option value="loan">Loan</option>
            </select>

            <label htmlFor="currency">Currency</label>
            <input
                id="currency"
                type="text"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
            />

            <label htmlFor="currentBalance">Current Balance</label>
            <input
                id="currentBalance"
                type="number"
                value={currentBalance}
                onChange={(e) => setCurrentBalance(e.target.value)}
                step="0.01"
            />

            <label htmlFor="institution">Institution (optional)</label>
            <input
                id="institution"
                type="text"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
            />

            <label htmlFor="note">Note (optional)</label>
            <textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
            />

            {error && <p>{error}</p>}

            <button type="submit">Save Account</button>
        </form>
    )
}

export default AddAccountForm
