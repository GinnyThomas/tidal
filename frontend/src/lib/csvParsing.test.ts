// lib/csvParsing.test.ts
//
// Purpose: Tests for the shared parseDate/parseAmount helpers used by both
// CsvMappingForm (manual column mapping) and every bank CSV/XLSX template.

import { parseDate, parseAmount, clampPayee, MAX_PAYEE_LENGTH } from './csvParsing'

describe('parseDate', () => {
  it('parses DD/MM/YYYY to ISO', () => {
    expect(parseDate('15/01/2026', 'DD/MM/YYYY')).toEqual({ date: '2026-01-15' })
  })

  it('parses MM/DD/YYYY to ISO', () => {
    expect(parseDate('01/15/2026', 'MM/DD/YYYY')).toEqual({ date: '2026-01-15' })
  })

  it('passes through YYYY-MM-DD', () => {
    expect(parseDate('2026-01-15', 'YYYY-MM-DD')).toEqual({ date: '2026-01-15' })
  })

  it('rejects an empty string', () => {
    expect(parseDate('', 'DD/MM/YYYY')).toEqual({ error: 'Empty date' })
  })

  it('rejects an out-of-range month', () => {
    const result = parseDate('15/13/2026', 'DD/MM/YYYY')
    expect('error' in result).toBe(true)
  })
})

describe('parseAmount', () => {
  it('parses a plain positive amount', () => {
    expect(parseAmount('42.50', '.')).toEqual({ amount: '42.50' })
  })

  it('parses a period-decimal negative amount with comma thousands separator', () => {
    expect(parseAmount('-1,234.56', '.')).toEqual({ amount: '-1234.56' })
  })

  it('parses a comma-decimal negative amount with period thousands separator', () => {
    expect(parseAmount('-1.234,56', ',')).toEqual({ amount: '-1234.56' })
  })

  it('rejects an empty string', () => {
    expect(parseAmount('', '.')).toEqual({ error: 'Empty amount' })
  })

  it('rejects a non-numeric string', () => {
    const result = parseAmount('not a number', '.')
    expect('error' in result).toBe(true)
  })

  it('normalises -0 to 0.00', () => {
    expect(parseAmount('-0.00', '.')).toEqual({ amount: '0.00' })
  })

  // Regression: Santander España (and possibly other European banks) uses
  // the Unicode MINUS SIGN (U+2212, "−") instead of ASCII hyphen-minus.
  // parseFloat() doesn't recognise U+2212 at all, so every negative amount
  // would fail to parse. This bit both the dedicated santanderEs.ts template
  // AND manual column mapping (CsvMappingForm) before parseAmount() handled
  // it centrally — a real Santander export with only "Transaction date,
  // Description, Amount, Currency" headers doesn't match the template's
  // detection (which requires "Value date" + "Balance" too), so it fell
  // through to manual mapping where the fix needs to live.
  it('parses a Unicode MINUS SIGN (U+2212) the same as ASCII hyphen-minus', () => {
    expect(parseAmount('−31,95', ',')).toEqual({ amount: '-31.95' })
  })

  it('parses a Unicode-minus amount with thousands separators too', () => {
    expect(parseAmount('−1.234,56', ',')).toEqual({ amount: '-1234.56' })
  })
})

describe('clampPayee', () => {
  // Regression: Transaction.payee is capped at 100 chars server-side, but
  // Spanish direct debit descriptions ("RECIBO Santander Generales Seguros y
  // Reaseguros Nº RECIBO 0049 1555 755 BBGXCWZ REF. MANDATO...") routinely
  // exceed it. Since the import request sends every row's payee in one
  // batch, a single overlong row failed Pydantic validation for the whole
  // request — silently blocking every other row in the file, not just the
  // long one.
  it('passes a short payee through unchanged', () => {
    expect(clampPayee('Tesco')).toEqual({ payee: 'Tesco', notes: undefined })
  })

  it('truncates a payee over the limit and preserves the full text in notes', () => {
    const long = 'RECIBO Santander Generales Seguros y Reaseguros Nº RECIBO 0049 1555 755 BBGXCWZ REF. MANDATO 123456789'
    const result = clampPayee(long)
    expect(result.payee.length).toBe(MAX_PAYEE_LENGTH)
    expect(result.payee).toBe(long.slice(0, MAX_PAYEE_LENGTH))
    expect(result.notes).toBe(long)
  })

  it('appends the overflow to existing notes rather than replacing them', () => {
    const long = 'X'.repeat(150)
    const result = clampPayee(long, 'existing note')
    expect(result.notes).toBe(`${long} — existing note`)
  })

  it('does not touch notes when payee is within the limit', () => {
    expect(clampPayee('Tesco', 'birthday gift')).toEqual({ payee: 'Tesco', notes: 'birthday gift' })
  })

  it('treats a payee exactly at the limit as unchanged', () => {
    const exact = 'X'.repeat(MAX_PAYEE_LENGTH)
    expect(clampPayee(exact)).toEqual({ payee: exact, notes: undefined })
  })
})
