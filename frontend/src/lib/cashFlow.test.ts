// lib/cashFlow.test.ts
//
// Tests for computeClosingBalances — the Annual view's cash flow maths,
// extracted so the previous year's closing can be computed for carry-forward.

import { describe, expect, it } from 'vitest'
import { computeClosingBalances } from './cashFlow'
import type { AnnualPlan } from './planTypes'

type Row = AnnualPlan['months'][number]['rows'][number]

const row = (overrides: Partial<Row> = {}): Row => ({
    category_id: 'cat-001',
    category_name: 'Bills',
    parent_category_id: null,
    planned: '0.00',
    actual: '0.00',
    remaining: '0.00',
    pending: '0.00',
    group: null,
    is_income: false,
    ...overrides,
})

// Same row in every month
function plan(year: number, rows: Row[], openingBalances: { group: string; amount: string }[] = []): AnnualPlan {
    return {
        year,
        months: Array.from({ length: 12 }, (_, i) => ({
            year,
            month: i + 1,
            rows,
            total_planned: '0.00',
            total_actual: '0.00',
            total_remaining: '0.00',
            total_pending: '0.00',
        })),
        opening_balances: openingBalances.map((ob, i) => ({
            id: `ob-${i}`,
            group: ob.group,
            year,
            opening_balance: ob.amount,
            currency: 'GBP',
        })),
    }
}

const JUNE_15_2026 = new Date(2026, 5, 15)

describe('computeClosingBalances', () => {
    it('starts from the opening balance and runs income minus expenses month by month', () => {
        const p = plan(2027, [
            row({ category_id: 'salary', planned: '1000.00', is_income: true }),
            row({ category_id: 'rent', planned: '600.00' }),
        ], [{ group: 'General', amount: '500.00' }])

        const closing = computeClosingBalances(p, 'General', null, JUNE_15_2026)

        expect(closing).toHaveLength(12)
        expect(closing[0]).toBe(900)    // 500 + 1000 - 600
        expect(closing[11]).toBe(5300)  // 500 + 12 × 400
    })

    it('treats a missing opening balance as zero', () => {
        const p = plan(2027, [row({ planned: '100.00' })])

        expect(computeClosingBalances(p, 'General', null, JUNE_15_2026)[0]).toBe(-100)
    })

    it('uses actuals for a past year', () => {
        const p = plan(2025, [row({ planned: '100.00', actual: '40.00' })])

        expect(computeClosingBalances(p, 'General', null, JUNE_15_2026)[11]).toBe(-480)
    })

    it('in the current year, uses actuals before this month and planned from this month on', () => {
        const p = plan(2026, [row({ planned: '100.00', actual: '40.00' })])

        const closing = computeClosingBalances(p, 'General', null, JUNE_15_2026)

        expect(closing[4]).toBe(-200)          // Jan–May actual: 5 × 40
        expect(closing[5]).toBe(-300)          // June is current → planned
        expect(closing[11]).toBe(-200 - 700)   // Jun–Dec planned: 7 × 100
    })

    it('with rowsGroup set, only counts categories resolved to that group (null → General)', () => {
        const p = plan(2027, [
            row({ category_id: 'uk', planned: '100.00', group: 'UK' }),
            row({ category_id: 'es', planned: '50.00', group: 'España' }),
            row({ category_id: 'none', planned: '10.00', group: null }),
        ], [{ group: 'UK', amount: '1000.00' }])

        expect(computeClosingBalances(p, 'UK', 'UK', JUNE_15_2026)[0]).toBe(900)
        expect(computeClosingBalances(p, 'General', 'General', JUNE_15_2026)[0]).toBe(-10)
    })

    it("resolves a category's group from the first month that has one", () => {
        // Category has no group in January but is UK from February —
        // the Annual view treats it as UK for the whole year.
        const p = plan(2027, [])
        p.months[0].rows = [row({ planned: '100.00', group: null })]
        p.months[1].rows = [row({ planned: '100.00', group: 'UK' })]

        expect(computeClosingBalances(p, 'UK', 'UK', JUNE_15_2026)[1]).toBe(-200)
        expect(computeClosingBalances(p, 'General', 'General', JUNE_15_2026)[1]).toBe(0)
    })
})
