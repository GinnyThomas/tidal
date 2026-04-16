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

// jsdom has no layout engine, so it doesn't implement Element.scrollIntoView.
// Several pages call scrollIntoView inside a setTimeout after opening an
// edit form (AccountsPage, SchedulesPage, CategoriesPage, BudgetsPage).
// Without this stub, those callbacks fire after the test completes and
// throw uncaught exceptions that pollute the test output.
//
// A no-op stub matches the behaviour we want in tests (the call is for
// UX smoothness only) and matches the real browser contract closely enough
// that no test code needs to change.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
}
