// lib/planTypes.ts
//
// Response shapes for GET /api/v1/plan/{year}. Shared by AnnualView and the
// libraries that work on its data (annualPlanCache, cashFlow), so those
// libraries don't have to import from a page.

export type PlanRow = {
    category_id: string
    category_name: string
    parent_category_id: string | null
    planned: string
    actual: string
    remaining: string
    pending: string
    group: string | null
    is_income: boolean
}

export type MonthlyPlan = {
    year: number
    month: number
    rows: PlanRow[]
    total_planned: string
    total_actual: string
    total_remaining: string
    total_pending: string
}

export type OpeningBalance = {
    id: string
    group: string
    year: number
    opening_balance: string
    currency: string
}

export type AnnualPlan = {
    year: number
    months: MonthlyPlan[]
    opening_balances: OpeningBalance[]
}
