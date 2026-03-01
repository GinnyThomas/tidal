// This file runs before every test file via the setupFiles config in vite.config.ts.
//
// Importing @testing-library/jest-dom extends vitest's expect() with custom
// DOM matchers:
//   toBeInTheDocument() — checks the element is actually in the DOM
//   toHaveValue()       — checks an input's current value
//   toBeVisible()       — checks the element is visible to the user
//   toBeDisabled()      — checks a form element is disabled
//   ... and many more
//
// These matchers make test assertions much more readable than raw DOM queries.
import '@testing-library/jest-dom'
