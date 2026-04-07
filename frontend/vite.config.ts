// vite.config.ts — production build and dev server configuration only.
//
// Test configuration has been moved to vitest.config.ts so that this file
// stays clean and the production build does not need the vitest type augmentation.

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
