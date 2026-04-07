import axios from 'axios'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SyntheticEvent } from 'react'
import { getApiBaseUrl } from '../lib/api'


function LoginPage() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const navigate = useNavigate()

    const handleSubmit = async (e: SyntheticEvent) => {
        e.preventDefault()  // stops the page refreshing on form submit
        setError(null)  // clear any previous error before each attempt
        try {
            const response = await axios.post(
                `${getApiBaseUrl()}/api/v1/auth/login`,
                {email, password}
            )
            localStorage.setItem("access_token", response.data.access_token)
            // then after successful login:
            navigate('/dashboard')
        } catch (err) {
            setError("Invalid Credentials")
        }
    }

    return (
        <form onSubmit={handleSubmit}>
            <label htmlFor="email">Email</label>
            <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
            />

            <label htmlFor="password">Password</label>
            <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
            />

            {error && <p>{error}</p>}

            <button type="submit">Log In</button>

            <p>
                Don't have an account? <a href="/register">Register here</a>
            </p>
        </form>
    )
}

export default LoginPage