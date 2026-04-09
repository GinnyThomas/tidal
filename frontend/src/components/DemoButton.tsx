// components/DemoButton.tsx
//
// Purpose: One-click demo account login button shown on LoginPage and RegisterPage.
//
// Behaviour:
//   - Calls POST /api/v1/auth/login with the shared demo credentials.
//   - On success: stores the token + email in localStorage, navigates to /dashboard.
//   - On failure: shows a short error message below the button.
//     (Demo account must be seeded first via backend/scripts/seed_demo.py.)
//
// Credentials are imported from lib/demo.ts so they are defined in one place.

import axios from 'axios'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getApiBaseUrl } from '../lib/api'
import { DEMO_EMAIL, DEMO_PASSWORD } from '../lib/demo'

function DemoButton() {
    const [error, setError] = useState<string | null>(null)
    const navigate = useNavigate()

    const handleClick = async () => {
        setError(null)
        try {
            const response = await axios.post(
                `${getApiBaseUrl()}/api/v1/auth/login`,
                { email: DEMO_EMAIL, password: DEMO_PASSWORD }
            )
            localStorage.setItem('access_token', response.data.access_token)
            localStorage.setItem('user_email', DEMO_EMAIL)
            navigate('/dashboard')
        } catch {
            setError('Demo account not available. Please try again later.')
        }
    }

    return (
        <div>
            <button
                onClick={handleClick}
                className="btn-secondary w-full cursor-pointer"
            >
                Try Demo 🌊
            </button>
            {error && (
                <p className="text-coral-400 text-sm text-center mt-2">{error}</p>
            )}
        </div>
    )
}

export default DemoButton
