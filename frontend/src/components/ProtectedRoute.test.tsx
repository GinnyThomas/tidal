import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ProtectedRoute from './ProtectedRoute'


describe('ProtectedRoute', () => {
    beforeEach(() => {
        localStorage.clear()  // start each test with empty localStorage
    })

    it('redirects to login when no token is present', () => {
        // No localStorage.setItem here — token is absent

        render(
            <MemoryRouter initialEntries={['/dashboard']}>
                <Routes>
                    <Route
                        path="/dashboard"
                        element={
                            <ProtectedRoute>
                                <p>Protected Content</p>
                            </ProtectedRoute>
                        }
                    />
                    <Route path="/login" element={<p>Login Page</p>} />
                </Routes>
            </MemoryRouter>
        )

        expect(screen.getByText('Login Page')).toBeInTheDocument()
        expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
    })

    it('redirects to protected content when a valid token is present', async () => {
        localStorage.setItem( 'access_token', 'fake-jwt-token')

        render(
            <MemoryRouter initialEntries={['/dashboard']}>
                <Routes>
                    <Route
                        path="/dashboard"
                        element={
                            <ProtectedRoute>
                                <p>Protected Content</p>
                            </ProtectedRoute>
                        }
                    />
                </Routes>
            </MemoryRouter>
        )

        expect(await screen.findByText('Protected Content')).toBeInTheDocument()
    })
})