// lib/csvTemplates/dateUtils.ts
//
// Shared date parsing utilities for CSV templates.

/**
 * Parse a DD/MM/YYYY date string to ISO YYYY-MM-DD.
 * Returns null if the input is not a valid date in this format.
 */
export function parseDDMMYYYY(raw: string): string | null {
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return null
  const [, dd, mm, yyyy] = match
  // Basic validity check — avoids producing invalid ISO strings
  const d = parseInt(dd, 10)
  const m = parseInt(mm, 10)
  const y = parseInt(yyyy, 10)
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900) return null
  return `${yyyy}-${mm}-${dd}`
}
