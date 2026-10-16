// lib/cashFlow.ts
//
// Cash flow maths for the Annual view: opening balance → closing balance
// for each month of a year.
//
// Extracted from AnnualView so the *previous* year's closing balance can be
// computed with exactly the same rules when carrying it forward as the next
// year's opening balance.
//
// Rules:
//   - Past months use actual amounts; the current and future months use
//     planned amounts (actuals aren't final until the month is over).
//   - is_income categories add to the balance; everything else subtracts.
//   - A category's group is the first non-null group it has in any month,
//     falling back to 'General'.

import type { AnnualPlan } from '../pages/AnnualView'

type CategoryTotals = {
    group: string | null
    isIncome: boolean
    planned: number[]
    actual: number[]
}

/**
 * Closing balance at the end of each month (index 0 = January).
 *
 * @param openingGroup  whose opening balance to start from (missing → 0)
 * @param rowsGroup     only count categories in this group; null counts all
 *                      (the Annual view's single, ungrouped table)
 * @param today         injectable clock, for deciding which months are past
 */
export function computeClosingBalances(
    plan: AnnualPlan,
    openingGroup: string,
    rowsGroup: string | null,
    today: Date = new Date(),
): number[] {
    const byCategory = new Map<string, CategoryTotals>()
    plan.months.forEach((monthPlan, monthIdx) => {
        for (const row of monthPlan.rows) {
            let totals = byCategory.get(row.category_id)
            if (!totals) {
                totals = {
                    group: row.group ?? null,
                    isIncome: row.is_income ?? false,
                    planned: Array(12).fill(0),
                    actual: Array(12).fill(0),
                }
                byCategory.set(row.category_id, totals)
            }
            totals.planned[monthIdx] = parseFloat(row.planned)
            totals.actual[monthIdx] = parseFloat(row.actual)
            if (row.group && !totals.group) totals.group = row.group
        }
    })

    const isPastMonth = (monthIdx: number) =>
        plan.year < today.getFullYear() ||
        (plan.year === today.getFullYear() && monthIdx < today.getMonth())

    const counted = [...byCategory.values()].filter(
        (c) => rowsGroup === null || (c.group ?? 'General') === rowsGroup,
    )

    const ob = plan.opening_balances?.find((b) => b.group === openingGroup)
    let running = ob ? parseFloat(ob.opening_balance) : 0
    const closing: number[] = []
    for (let i = 0; i < 12; i++) {
        for (const c of counted) {
            const amount = isPastMonth(i) ? c.actual[i] : c.planned[i]
            running += c.isIncome ? amount : -amount
        }
        closing.push(running)
    }
    return closing
}
