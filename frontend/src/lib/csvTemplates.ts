// lib/csvTemplates.ts
//
// Central registry of bank CSV import templates.
//
// A CsvTemplate knows:
//   - matches(): whether a set of CSV headers came from this bank
//   - parse():   how to turn one raw row into a normalised ParsedRow
//
// ParsedRow is the canonical shape that the import flow and dedup logic work
// with. Templates handle all bank-specific quirks (date formats, decimal
// separators, signed vs debit/credit columns) internally.

export interface CsvTemplate {
  id: string
  name: string
  /**
   * true  = tested against a real bank export; included in auto-detection.
   * false = stub / unverified; skipped by auto-detection so we never silently
   *         mis-parse a real file. Falls through to manual mapping instead.
   */
  verified: boolean
  /** Return true if these headers (lowercased, trimmed) look like this bank's export. */
  matches: (headers: string[]) => boolean
  /**
   * Parse one raw row.
   *   ParsedRow        — success
   *   { error: string } — row has data but failed to parse; will be shown to the user
   *   null              — row is blank / metadata; silently skipped
   */
  parse: (row: Record<string, string>) => ParsedRow | { error: string } | null
}

export interface ParsedRow {
  date: string       // ISO YYYY-MM-DD
  amount: string     // "12.34" or "-12.34" — always 2 decimal places, period separator
  payee: string
  notes?: string
  externalId?: string
}

/** A row that had data but could not be parsed. Shown in the review UI. */
export interface ParseFailedRow {
  rowNumber: number                    // 1-indexed (1 = header, so data rows start at 2)
  rawRow: Record<string, string>
  reason: string
}

// Import all four templates. The order determines match priority —
// more specific templates (more header columns) should come first.
import { barclaysTemplate } from './csvTemplates/barclays'
import { monzoTemplate } from './csvTemplates/monzo'
import { virginTemplate } from './csvTemplates/virgin'
import { santanderEsTemplate } from './csvTemplates/santanderEs'

export const ALL_TEMPLATES: CsvTemplate[] = [
  monzoTemplate,
  virginTemplate,
  santanderEsTemplate,
  barclaysTemplate,
]

/**
 * Given a list of CSV header names, return the matching verified built-in template,
 * or null if none match (falls back to manual mapping).
 *
 * Only templates with verified=true are considered. Unverified stubs (e.g. Barclays,
 * which was written without a real sample) are excluded — a false-positive auto-match
 * is worse than falling through to manual mapping.
 */
export function detectTemplate(headers: string[]): CsvTemplate | null {
  const normalised = headers.map(h => h.trim().toLowerCase())
  return ALL_TEMPLATES.find(t => t.verified && t.matches(normalised)) ?? null
}
