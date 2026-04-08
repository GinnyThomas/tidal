// vite.config.ts — production build and dev server configuration.
//
// @tailwindcss/vite handles the @import "tailwindcss" directive in index.css.
// This is the Tailwind v4 approach — no postcss.config.js needed.
//
// Test configuration lives in vitest.config.ts.

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
