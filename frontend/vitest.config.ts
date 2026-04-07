// vitest.config.ts — test runner configuration only.
//
// Kept separate from vite.config.ts so that the production build (vite build)
// does not need the vitest type augmentation, and Vercel's `tsc -b` step only
// sees production code when it type-checks the app.
//
// `defineConfig` is imported from 'vitest/config' (not 'vite') so TypeScript
// knows the 'test' property is valid without a triple-slash directive.

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  test: {
    // jsdom simulates browser APIs (document, window, etc.) inside Node.js.
    // React components need a DOM to render into, even in tests.
    environment: 'jsdom',

    // Makes describe, it, expect, vi, etc. available globally in test files
    // without needing to import them — mirrors how Jest works.
    globals: true,

    // This file runs before every test file. We use it to load custom
    // matchers like toBeInTheDocument() from @testing-library/jest-dom.
    setupFiles: ['src/setupTests.ts'],
  },
})
