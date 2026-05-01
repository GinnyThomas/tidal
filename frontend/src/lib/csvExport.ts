// lib/csvExport.ts
//
// Shared CSV generation and download utilities.
//
// RFC 4180-compliant cell escaping with formula-injection prevention.
// Used by AnnualView and MonthlyPlanView for the "Export CSV" feature.

/**
 * Escape a single CSV cell value.
 * - Neutralizes formula injection (=, +, -, @ at start → prefix with space)
 * - Escapes embedded double quotes by doubling them
 * - Always wraps in double quotes for consistency
 */
export function escapeCsvCell(value: string): string {
    if (/^[=+\-@]/.test(value)) value = ' ' + value
    return '"' + value.replace(/"/g, '""') + '"'
}

/** Build a complete CSV string from a 2D array of cell values. */
export function buildCsvContent(rows: string[][]): string {
    return rows.map(row => row.map(escapeCsvCell).join(',')).join('\n')
}

/** Trigger a CSV file download in the browser. */
export function downloadCsv(content: string, filename: string): void {
    const blob = new Blob([content], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
}
