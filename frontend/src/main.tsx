// main.tsx — application entry point
//
// This is where React attaches to the HTML page. The browser loads index.html,
// which contains <div id="root"></div>. This file finds that div and renders
// our App component into it.
//
// StrictMode note: React's StrictMode intentionally runs effects twice in
// development to help catch bugs. That's useful in general, but in Phase 0
// it means our useEffect health check fires twice, which adds noise while
// we're learning. We'll add it back once the codebase is stable.

import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// getElementById can return null if the element doesn't exist — the ! tells
// TypeScript "trust me, this element is definitely there" (it's in index.html).
createRoot(document.getElementById('root')!).render(<App />)
