// App.tsx — Phase 0 walking skeleton
//
// Single responsibility: call the backend health endpoint and display the result.
// No routing, no auth, no styling — just proving the frontend can reach the backend.

import { useEffect, useState } from 'react'
import axios from 'axios'

// Describes the JSON shape returned by GET /api/v1/health.
// Keeping this here for Phase 0 — in later phases, types move to src/types/.
interface HealthResponse {
  status: string
  app: string
}

function App() {
  // null means "we haven't received data yet" — distinct from having received bad data.
  const [health, setHealth] = useState<HealthResponse | null>(null)

  // true initially because the request starts immediately on mount.
  const [loading, setLoading] = useState<boolean>(true)

  // null means "no error" — a string means something went wrong.
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Empty dependency array [] means this effect runs once, when the component
    // first renders. This is the right place for one-time setup like data fetching.
    axios
      .get<HealthResponse>('http://localhost:8000/api/v1/health')
      .then((response) => {
        // response.data is typed as HealthResponse because of the generic above.
        setHealth(response.data)
      })
      .catch((err: unknown) => {
        // We type err as unknown (TypeScript best practice) and narrow it before use.
        // axios errors are instances of Error, so this covers most cases.
        if (err instanceof Error) {
          setError(err.message)
        } else {
          setError('An unexpected error occurred')
        }
      })
      .finally(() => {
        // This runs whether the request succeeded or failed.
        // Always turn off the loading spinner when the request settles.
        setLoading(false)
      })
  }, [])

  // Render the appropriate UI for each state.
  // Phase 0 uses plain text — no styling yet, just proving the data flows.

  if (loading) {
    return <p>Checking backend connection...</p>
  }

  if (error) {
    return <p>Error: {error}</p>
  }

  return (
    <div>
      <h1>Tidal</h1>
      {/* health could theoretically be null here but loading and error are both
          false, meaning the request completed successfully. health will be set.
          The optional chaining (?.) keeps TypeScript happy. */}
      <p>Status: {health?.status}</p>
      <p>App: {health?.app}</p>
    </div>
  )
}

export default App
