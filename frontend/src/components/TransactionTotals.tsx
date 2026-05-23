// components/TransactionTotals.tsx
//
// Purpose: Four metric cards showing Expenses, Income, Transfers, Net
//          for filtered transactions. Per-currency lines stacked when
//          multi-currency. Only rendered when a filter is active.

import { fmtCurrency } from '../lib/formatting'

type CurrencyAmount = {
    currency: string
    amount: string
}

type Totals = {
    expenses: CurrencyAmount[]
    income: CurrencyAmount[]
    transfers: CurrencyAmount[]
    net: CurrencyAmount[]
}

type Props = {
    totals: Totals
}

const CURRENCY_SYMBOLS: Record<string, string> = {
    GBP: '\u00a3', EUR: '\u20ac', USD: '$', CHF: 'CHF ',
    CAD: 'C$', AUD: 'A$', NZD: 'NZ$', JPY: '\u00a5',
    SEK: 'kr ', NOK: 'kr ', DKK: 'kr ',
}

function symbolFor(currency: string): string {
    return CURRENCY_SYMBOLS[currency] ?? `${currency} `
}

function renderLines(items: CurrencyAmount[], colorClass: string) {
    if (items.length === 0) return <span className="text-slate-500">&mdash;</span>
    return items.map(({ currency, amount }) => {
        const n = parseFloat(amount)
        const sign = n < 0 ? '-' : ''
        const formatted = fmtCurrency(Math.abs(n))
        return (
            <div key={currency} className={colorClass}>
                {sign}{symbolFor(currency)}{formatted}
            </div>
        )
    })
}

function netColor(amount: string): string {
    const n = parseFloat(amount)
    if (n > 0) return 'text-success'
    if (n < 0) return 'text-danger'
    return 'text-slate-300'
}

function TransactionTotals({ totals }: Props) {
    return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4" aria-label="Transaction totals">
            {/* Expenses */}
            <div className="bg-ocean-800 border border-ocean-700 rounded-lg px-4 py-3">
                <div className="text-xs text-coral-400 font-medium mb-1">Expenses</div>
                <div className="text-sm font-medium">
                    {renderLines(totals.expenses, 'text-coral-400')}
                </div>
            </div>

            {/* Income */}
            <div className="bg-ocean-800 border border-ocean-700 rounded-lg px-4 py-3">
                <div className="text-xs text-success font-medium mb-1">Income</div>
                <div className="text-sm font-medium">
                    {renderLines(totals.income, 'text-success')}
                </div>
            </div>

            {/* Transfers */}
            <div className="bg-ocean-800 border border-ocean-700 rounded-lg px-4 py-3">
                <div className="text-xs text-sky-400 font-medium mb-1">Transfers</div>
                <div className="text-sm font-medium">
                    {renderLines(totals.transfers, 'text-sky-400')}
                </div>
            </div>

            {/* Net */}
            <div className="bg-ocean-800 border border-ocean-700 rounded-lg px-4 py-3">
                <div className="text-xs text-slate-400 font-medium mb-1">Net</div>
                <div className="text-sm font-medium">
                    {totals.net.length === 0
                        ? <span className="text-slate-500">&mdash;</span>
                        : totals.net.map(({ currency, amount }) => {
                            const n = parseFloat(amount)
                            const sign = n < 0 ? '-' : n > 0 ? '+' : ''
                            return (
                                <div key={currency} className={netColor(amount)}>
                                    {sign}{symbolFor(currency)}{fmtCurrency(Math.abs(n))}
                                </div>
                            )
                        })
                    }
                </div>
            </div>
        </div>
    )
}

export default TransactionTotals
export type { Totals, CurrencyAmount }
