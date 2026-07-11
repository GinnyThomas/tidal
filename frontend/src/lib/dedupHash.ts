// lib/dedupHash.ts
//
// Client-side dedup hash computation — mirrors the backend's compute_dedup_hash().
//
// Hash: SHA-256 of "{account_id}|{date_iso}|{amount_str}|{payee_normalized}"
//   - amount_str: fixed 2 decimal places (e.g. "-12.34")
//   - payee_normalized: lowercase, stripped, internal spaces collapsed
//
// Used in the Import Review step to classify rows as New / Duplicate /
// Possible Duplicate before sending them to the backend.

function normalizePayee(payee: string): string {
  return payee.trim().toLowerCase().replace(/\s+/g, ' ')
}

function formatAmount(amount: string): string {
  const n = parseFloat(amount)
  if (isNaN(n)) return amount
  // Normalise -0 to 0 so the hash matches the backend (Python Decimal("-0.00")
  // formats as "-0.00", which would otherwise produce a different hash).
  return Object.is(n, -0) ? '0.00' : n.toFixed(2)
}

/**
 * Compute the SHA-256 dedup hash for a transaction.
 * Returns a hex string.
 *
 * Uses the Web Crypto API (available in all modern browsers and jsdom).
 */
export async function computeDedupHash(
  accountId: string,
  dateIso: string,
  amount: string,
  payee: string,
): Promise<string> {
  const amountStr = formatAmount(amount)
  const payeeNorm = normalizePayee(payee)
  const raw = `${accountId}|${dateIso}|${amountStr}|${payeeNorm}`
  const encoded = new TextEncoder().encode(raw)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}
