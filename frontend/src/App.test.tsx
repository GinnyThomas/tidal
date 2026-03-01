// App.test.tsx — Phase 0 test suite for the App component
//
// TDD approach: this test was written to define what the component must do,
// then the component was written to satisfy it.
//
// We test BEHAVIOUR not implementation:
//   - Does the user see a loading message while data is fetching?
//   - Does the user see the health data when the backend responds?
// We do NOT test: which axios method was called, how many times, with what args.

import { render, screen } from '@testing-library/react'
import axios from 'axios'
import App from './App'

// Replace the real axios module with a controlled fake for all tests in this file.
//
// The factory function shape must match the module's export shape:
//   - 'default' is the default export — what you get with: import axios from 'axios'
//   - We only need 'get' here since App.tsx only calls axios.get()
//
// vi.mock() calls are automatically hoisted by Vitest to the top of the file,
// before any imports execute. This ensures axios is mocked before App.tsx loads it.
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}))

describe('App', () => {
  it('shows a loading message while the health check is in progress', () => {
    // Arrange: return a promise that never resolves so the component stays loading.
    // This is a clean way to test loading state — no async/await needed.
    vi.mocked(axios.get).mockReturnValue(new Promise(() => {}))

    // Act: render the component
    render(<App />)

    // Assert: the user sees the loading message
    // getByText throws if the element is not found — no need for a separate assertion.
    expect(screen.getByText('Checking backend connection...')).toBeInTheDocument()
  })

  it('displays the health data when the backend responds successfully', async () => {
    // Arrange: resolve immediately with a fake successful response.
    // mockResolvedValueOnce wraps the value in a resolved Promise automatically.
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { status: 'ok', app: 'Tidal' },
    })

    // Act
    render(<App />)

    // Assert: findBy* queries are async — they retry until the element appears
    // or the timeout expires. We need this because the state update happens after
    // the promise resolves, which is asynchronous.
    expect(await screen.findByText('Status: ok')).toBeInTheDocument()
    expect(await screen.findByText('App: Tidal')).toBeInTheDocument()
  })
})
