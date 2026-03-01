/// <reference types="vitest" />
// The triple-slash directive above tells TypeScript that this defineConfig
// also accepts a 'test' block (Vitest's config shape). Without it, the
// 'test' property below would cause a TypeScript error.

import { defineConfig } from 'vite'
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
