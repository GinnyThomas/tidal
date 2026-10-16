// lib/cashFlow.ts
//
// Annual plan aggregation and cash flow maths for the Annual view:
// opening balance → closing balance for each month of a year.
//
// Shared by the Annual view's table and its carry-forward, so the previous
// year's closing balance is computed with exactly the same rules as the
// Closing Balance row shows.
//
// Rules:
//   - Past months use actual amounts; the current and future months use
//     planned amounts (actuals aren't final until the month is over).
//   - is_income categories add to the balance; everything else subtracts.
//   - A category's group is the first non-null group it has in any month,
//     falling back to 'General'.

import type { AnnualPlan } from './planTypes'

/** One category's figures across the 12 months of a plan. */
export type CategoryYear = {
    name: string
    parentId: string | null
    group: string | null
    isIncome: boolean
    amounts: string[]   // planned, index 0 = January
    actuals: string[]
}

/** Collapse a plan's 12 × N rows into one entry per category. */
export function aggregateByCategory(plan: AnnualPlan): Map<string, CategoryYear> {
    const byCategory = new Map<string, CategoryYear>()
    plan.months.forEach((monthPlan, monthIdx) => {
        for (const row of monthPlan.rows) {
            let entry = byCategory.get(row.category_id)
            if (!entry) {
                entry = {
                    name: row.category_name,
                    parentId: row.parent_category_id,
                    group: row.group ?? null,
                    isIncome: row.is_income ?? false,
                    amounts: Array(12).fill('0.00'),
                    actuals: Array(12).fill('0.00'),
                }
                byCategory.set(row.category_id, entry)
            }
            entry.amounts[monthIdx] = row.planned
            entry.actuals[monthIdx] = row.actual
            // First non-null group from any month wins
            if (row.group && !entry.group) entry.group = row.group
        }
    })
    return byCategory
}

/**
 * Closing balance at the end of each month (index 0 = January).
 *
 * @param openingGroup  whose opening balance to start from (missing → 0)
 * @param rowsGroup     only count categories in this group; null counts all
 *                      (the Annual view's single, unfiltered table)
 * @param today         injectable clock, for deciding which months are past
 * @param categories    pass an existing aggregateByCategory(plan) to reuse it
 */
export function computeClosingBalances(
    plan: AnnualPlan,
    openingGroup: string,
    rowsGroup: string | null,
    today: Date = new Date(),
    categories: Map<string, CategoryYear> = aggregateByCategory(plan),
): number[] {
    const isPastMonth = (monthIdx: number) =>
        plan.year < today.getFullYear() ||
        (plan.year === today.getFullYear() && monthIdx < today.getMonth())

    const counted = [...categories.values()].filter(
        (c) => rowsGroup === null || (c.group ?? 'General') === rowsGroup,
    )

    const ob = plan.opening_balances?.find((b) => b.group === openingGroup)
    let running = ob ? parseFloat(ob.opening_balance) : 0
    const closing: number[] = []
    for (let i = 0; i < 12; i++) {
        for (const c of counted) {
            const amount = parseFloat(isPastMonth(i) ? c.actuals[i] : c.amounts[i])
            running += c.isIncome ? amount : -amount
        }
        closing.push(running)
    }
    return closing
}
