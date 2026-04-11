// lib/budgetGroups.ts
//
// Canonical group display order for budget sections.
// "General" is the sentinel for budgets/rows with no group assigned.
// Used by MonthlyPlanView, AnnualView, and BudgetsPage to ensure
// consistent section ordering across all views.

export const GROUP_ORDER = ['UK', 'España', 'General'] as const
export type BudgetGroup = typeof GROUP_ORDER[number] | string
