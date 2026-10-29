import { render, screen } from '@testing-library/react'
import App from './App'
import {MemoryRouter} from "react-router-dom";


describe('App', () => {
  it('shows the Tidal text', () => {
    render(
        <MemoryRouter initialEntries={['/']}>
          <App />
        </MemoryRouter>
    )

    expect(screen.getByText('Tidal')).toBeInTheDocument()
  })

  it('redirects to the login page', async () => {
    render(
        <MemoryRouter initialEntries={['/login']}>
          <App />
        </MemoryRouter>
    )

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^password$/i, { selector: 'input' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument()
  })

  it('shows the forgot password page without logging in', () => {
    render(
        <MemoryRouter initialEntries={['/forgot-password']}>
          <App />
        </MemoryRouter>
    )
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument()
  })

  it('shows the reset password page without logging in', () => {
    render(
        <MemoryRouter initialEntries={['/reset-password?token=abc123']}>
          <App />
        </MemoryRouter>
    )
    expect(screen.getByRole('button', { name: /reset password/i })).toBeInTheDocument()
  })

  it('shows the privacy policy without logging in', () => {
    render(
        <MemoryRouter initialEntries={['/privacy']}>
          <App />
        </MemoryRouter>
    )
    expect(screen.getByRole('heading', { level: 1, name: /privacy policy/i })).toBeInTheDocument()
  })

  it('shows the terms of use without logging in', () => {
    render(
        <MemoryRouter initialEntries={['/terms']}>
          <App />
        </MemoryRouter>
    )
    expect(screen.getByRole('heading', { level: 1, name: /terms of use/i })).toBeInTheDocument()
  })
})
