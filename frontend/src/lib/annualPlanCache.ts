// lib/annualPlanCache.ts
//
// Session cache for the annual plan data.
// Persists across re-renders and route changes within the same browser tab,
// cleared automatically when the tab closes.
//
// Keyed by year string (e.g. "2026").
//
// Invalidated by:
//   - Transaction add/update/status toggle (TransactionsPage)
//   - Schedule add/update/active toggle (SchedulesPage)
//   - User logout (Layout)

import type { AnnualPlan } from '../pages/AnnualView'

export const annualPlanCache = new Map<string, AnnualPlan>()
