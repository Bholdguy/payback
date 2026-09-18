/**
 * Truncates a Nimiq address (e.g. "NQ15 0DR7 BLBD B1YE L9QB VF82 5SUC 47RG
 * KDFH") to its first and last group for display, so a payer isn't shown a
 * long raw string with no context (Step 9 design pass). There is no display
 * name system (SECURITY.md Section 1 — the address *is* the identity), so
 * this is display formatting only, not a replacement for the real value.
 */
export function formatAddressShort(address: string): string {
  const groups = address.trim().split(/\s+/)
  if (groups.length <= 2) return address
  return `${groups[0]}…${groups[groups.length - 1]}`
}
