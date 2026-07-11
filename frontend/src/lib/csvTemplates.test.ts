// lib/csvTemplates.test.ts
//
// Tests for template detection and per-bank row parsing.

import { describe, it, expect } from 'vitest'
import { detectTemplate, ALL_TEMPLATES } from './csvTemplates'
import { monzoTemplate } from './csvTemplates/monzo'
import { virginTemplate } from './csvTemplates/virgin'
import { santanderEsTemplate } from './csvTemplates/santanderEs'
import { barclaysTemplate } from './csvTemplates/barclays'


// =============================================================================
// Template detection
// =============================================================================

describe('detectTemplate', () => {
  it('returns Monzo template for Monzo headers', () => {
    const headers = [
      'transaction id', 'date', 'time', 'type', 'name', 'emoji',
      'category', 'amount', 'currency', 'local amount', 'local currency',
      'notes and #tags', 'address', 'receipt', 'description',
      'category split', 'money out', 'money in',
    ]
    const template = detectTemplate(headers)
    expect(template).not.toBeNull()
    expect(template!.id).toBe('monzo')
  })

  it('returns Virgin Money template for Virgin headers', () => {
    const headers = [
      'transaction date', 'posting date', 'billing amount', 'merchant',
      'merchant city', 'merchant state', 'merchant postcode', 'reference number',
      'debit or credit', 'sicmcc code', 'status', 'transaction currency',
      'additional card holder', 'card used',
    ]
    const template = detectTemplate(headers)
    expect(template).not.toBeNull()
    expect(template!.id).toBe('virgin')
  })

  it('returns Santander ES template for Santander headers', () => {
    const headers = [
      'transaction date', 'value date', 'description', 'amount', 'balance', 'currency',
    ]
    const template = detectTemplate(headers)
    expect(template).not.toBeNull()
    expect(template!.id).toBe('santander_es')
  })

  it('returns Barclays template for Barclays headers', () => {
    const headers = ['number', 'date', 'account', 'amount', 'subcategory', 'memo']
    const template = detectTemplate(headers)
    expect(template).not.toBeNull()
    expect(template!.id).toBe('barclays')
  })

  it('returns null for unknown headers', () => {
    const headers = ['col_a', 'col_b', 'col_c']
    expect(detectTemplate(headers)).toBeNull()
  })

  it('detection is case-insensitive', () => {
    const headers = ['Transaction ID', 'Date', 'Notes and #tags']
    const template = detectTemplate(headers)
    expect(template?.id).toBe('monzo')
  })
})


// =============================================================================
// Monzo template
// =============================================================================

describe('monzoTemplate', () => {
  const row = {
    'Transaction ID': 'tx_0000B4q3rrhVDhu2P1HVdj',
    'Date': '01/04/2026',
    'Time': '04:19:35',
    'Type': 'Direct Debit',
    'Name': 'David Lloyd Clubs',
    'Emoji': '',
    'Category': 'Personal care',
    'Amount': '-349.00',
    'Currency': 'GBP',
    'Local amount': '-349.00',
    'Local currency': 'GBP',
    'Notes and #tags': '081223AAEEE5.26267',
    'Address': '',
    'Receipt': '',
    'Description': '081223AAEEE5.26267',
    'Category split': '',
    'Money Out': '-349.00',
    'Money In': '',
  }

  it('parses date to ISO format', () => {
    const parsed = monzoTemplate.parse(row)
    expect(parsed?.date).toBe('2026-04-01')
  })

  it('parses negative amount as debit', () => {
    const parsed = monzoTemplate.parse(row)
    expect(parsed?.amount).toBe('-349.00')
  })

  it('uses Name as payee', () => {
    const parsed = monzoTemplate.parse(row)
    expect(parsed?.payee).toBe('David Lloyd Clubs')
  })

  it('uses Notes and #tags as notes', () => {
    const parsed = monzoTemplate.parse(row)
    expect(parsed?.notes).toBe('081223AAEEE5.26267')
  })

  it('uses Transaction ID as externalId', () => {
    const parsed = monzoTemplate.parse(row)
    expect(parsed?.externalId).toBe('tx_0000B4q3rrhVDhu2P1HVdj')
  })

  it('parses positive amount (income)', () => {
    const incomeRow = { ...row, 'Amount': '6000.00', 'Money In': '6000.00', 'Money Out': '' }
    const parsed = monzoTemplate.parse(incomeRow)
    expect(parsed?.amount).toBe('6000.00')
  })

  it('returns null for missing date', () => {
    expect(monzoTemplate.parse({ ...row, 'Date': '' })).toBeNull()
  })

  it('returns null for missing amount', () => {
    expect(monzoTemplate.parse({ ...row, 'Amount': '' })).toBeNull()
  })
})


// =============================================================================
// Virgin Money template
// =============================================================================

describe('virginTemplate', () => {
  const row = {
    'Transaction Date': '2026-07-05',
    'Posting Date': '2026-07-06',
    'Billing Amount': '13.14',
    'Merchant': 'AMAZON UK* B86ZA52Q5',
    'Merchant City': 'LONDON',
    'Merchant State': 'GBR',
    'Merchant Postcode': 'EC2A 2FA',
    'Reference Number': '85383906186500029457026',
    'Debit or Credit': 'DBIT',
    'SICMCC Code': 'PR',
    'Status': 'BILLED',
    'Transaction Currency': 'GBP',
    'Additional Card Holder': 'false',
    'Card Used': '5247',
  }

  it('parses YYYY-MM-DD date', () => {
    const parsed = virginTemplate.parse(row)
    expect(parsed?.date).toBe('2026-07-05')
  })

  it('applies negative sign for DBIT', () => {
    const parsed = virginTemplate.parse(row)
    expect(parsed?.amount).toBe('-13.14')
  })

  it('applies positive sign for CRDT', () => {
    const creditRow = { ...row, 'Debit or Credit': 'CRDT', 'Billing Amount': '5000.00' }
    const parsed = virginTemplate.parse(creditRow)
    expect(parsed?.amount).toBe('5000.00')
  })

  it('uses Merchant as payee', () => {
    const parsed = virginTemplate.parse(row)
    expect(parsed?.payee).toBe('AMAZON UK* B86ZA52Q5')
  })

  it('uses Reference Number as externalId', () => {
    const parsed = virginTemplate.parse(row)
    expect(parsed?.externalId).toBe('85383906186500029457026')
  })

  it('handles empty Reference Number', () => {
    const noRef = { ...row, 'Reference Number': '' }
    const parsed = virginTemplate.parse(noRef)
    expect(parsed?.externalId).toBeUndefined()
  })

  it('returns null for missing date', () => {
    expect(virginTemplate.parse({ ...row, 'Transaction Date': '' })).toBeNull()
  })

  it('returns null for invalid amount', () => {
    expect(virginTemplate.parse({ ...row, 'Billing Amount': 'N/A' })).toBeNull()
  })
})


// =============================================================================
// Santander ES template
// =============================================================================

describe('santanderEsTemplate', () => {
  // Unicode minus (U+2212) — not ASCII hyphen
  const MINUS = '\u2212'

  const row = {
    'Transaction date': '07/07/2026',
    'Value date': '07/07/2026',
    'Description': 'PAGO MOVIL EN SUPERMERCAT CON, SANT ADRIA DEES, TARJ. :*328714',
    'Amount': `${MINUS}31,95`,
    'Balance': '4.898,79',
    'Currency': 'EUR',
  }

  it('parses DD/MM/YYYY date to ISO', () => {
    const parsed = santanderEsTemplate.parse(row)
    expect(parsed?.date).toBe('2026-07-07')
  })

  it('parses Spanish decimal format with Unicode minus', () => {
    const parsed = santanderEsTemplate.parse(row)
    expect(parsed?.amount).toBe('-31.95')
  })

  it('parses large amounts with thousands separator', () => {
    const bigRow = { ...row, 'Amount': `${MINUS}1.000,00` }
    const parsed = santanderEsTemplate.parse(bigRow)
    expect(parsed?.amount).toBe('-1000.00')
  })

  it('parses positive balance amount', () => {
    const incomeRow = { ...row, 'Amount': '7.300,00' }
    const parsed = santanderEsTemplate.parse(incomeRow)
    expect(parsed?.amount).toBe('7300.00')
  })

  it('uses Description as payee', () => {
    const parsed = santanderEsTemplate.parse(row)
    expect(parsed?.payee).toBe('PAGO MOVIL EN SUPERMERCAT CON, SANT ADRIA DEES, TARJ. :*328714')
  })

  it('returns null for missing date', () => {
    expect(santanderEsTemplate.parse({ ...row, 'Transaction date': '' })).toBeNull()
  })

  it('returns null for missing amount', () => {
    expect(santanderEsTemplate.parse({ ...row, 'Amount': '' })).toBeNull()
  })
})


// =============================================================================
// Barclays stub template
// =============================================================================

describe('barclaysTemplate', () => {
  const row = {
    'Number': '10',
    'Date': '15/01/2026',
    'Account': '12345678',
    'Amount': '-42.50',
    'Subcategory': 'Groceries',
    'Memo': 'TESCO STORES',
  }

  it('parses DD/MM/YYYY date to ISO', () => {
    const parsed = barclaysTemplate.parse(row)
    expect(parsed?.date).toBe('2026-01-15')
  })

  it('parses signed amount', () => {
    const parsed = barclaysTemplate.parse(row)
    expect(parsed?.amount).toBe('-42.50')
  })

  it('uses Memo as payee', () => {
    const parsed = barclaysTemplate.parse(row)
    expect(parsed?.payee).toBe('TESCO STORES')
  })

  it('returns null for invalid date format', () => {
    expect(barclaysTemplate.parse({ ...row, 'Date': '2026-01-15' })).toBeNull()
  })
})
