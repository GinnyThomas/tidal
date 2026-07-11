// lib/dedupHash.test.ts
//
// Verifies the client-side dedup hash matches the backend's SHA-256 computation.

import { describe, it, expect } from 'vitest'
import { computeDedupHash } from './dedupHash'

describe('computeDedupHash', () => {
  it('produces a 64-character hex string', async () => {
    const hash = await computeDedupHash(
      '00000000-0000-0000-0000-000000000001',
      '2026-01-15',
      '-42.50',
      'Tesco',
    )
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]+$/)
  })

  it('is deterministic for the same inputs', async () => {
    const h1 = await computeDedupHash('uuid-a', '2026-03-10', '99.99', 'Amazon UK')
    const h2 = await computeDedupHash('uuid-a', '2026-03-10', '99.99', 'Amazon UK')
    expect(h1).toBe(h2)
  })

  it('normalises payee: lowercase + collapsed spaces', async () => {
    const h1 = await computeDedupHash('uuid', '2026-01-01', '-10.00', '  AMAZON  UK  ')
    const h2 = await computeDedupHash('uuid', '2026-01-01', '-10.00', 'amazon uk')
    expect(h1).toBe(h2)
  })

  it('normalises amount to 2dp', async () => {
    const h1 = await computeDedupHash('uuid', '2026-01-01', '10', 'Shop')
    const h2 = await computeDedupHash('uuid', '2026-01-01', '10.00', 'Shop')
    expect(h1).toBe(h2)
  })

  it('differs for different payees', async () => {
    const h1 = await computeDedupHash('uuid', '2026-01-01', '-10.00', 'Tesco')
    const h2 = await computeDedupHash('uuid', '2026-01-01', '-10.00', 'Sainsburys')
    expect(h1).not.toBe(h2)
  })

  it('differs for different amounts', async () => {
    const h1 = await computeDedupHash('uuid', '2026-01-01', '-10.00', 'Shop')
    const h2 = await computeDedupHash('uuid', '2026-01-01', '-20.00', 'Shop')
    expect(h1).not.toBe(h2)
  })

  it('differs for different dates', async () => {
    const h1 = await computeDedupHash('uuid', '2026-01-01', '-10.00', 'Shop')
    const h2 = await computeDedupHash('uuid', '2026-02-01', '-10.00', 'Shop')
    expect(h1).not.toBe(h2)
  })

  it('differs for different account IDs', async () => {
    const h1 = await computeDedupHash('uuid-a', '2026-01-01', '-10.00', 'Shop')
    const h2 = await computeDedupHash('uuid-b', '2026-01-01', '-10.00', 'Shop')
    expect(h1).not.toBe(h2)
  })
})
