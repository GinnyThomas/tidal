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
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument()
  })

})
