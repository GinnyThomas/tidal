// lib/formatting.ts
//
// Shared en-GB currency formatter for consistent amount display.
// Uses Intl.NumberFormat for locale-aware thousand separators and
// fixed 2 decimal places.

const gbFormatter = new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
})

/** Format a number with thousand separators (en-GB). */
export const fmtCurrency = (n: number): string => gbFormatter.format(n)

/** Format a string amount. Zero → "—", otherwise comma-formatted. */
export const fmtAmount = (amount: string): string => {
    const n = parseFloat(amount)
    return n === 0 ? '—' : fmtCurrency(n)
}
