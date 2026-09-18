import { LUNA_PER_NIM } from './SplitCalculator'

export class AmountParseError extends Error {}

/**
 * Parses a user-entered NIM amount (decimal string, e.g. "80" or "20.5") into
 * an integer Luna amount. Rejects anything that doesn't convert to a whole
 * number of Luna (NIM only in v1, PRD.md Section 0) rather than rounding
 * silently — a rounded input is not the amount the user typed.
 */
export function parseNimToLuna(nimInput: string): number {
  const trimmed = nimInput.trim()
  if (trimmed === '' || Number.isNaN(Number(trimmed))) {
    throw new AmountParseError(`"${nimInput}" is not a valid NIM amount`)
  }

  const luna = Number(trimmed) * LUNA_PER_NIM
  if (!Number.isSafeInteger(Math.round(luna)) || Math.abs(luna - Math.round(luna)) > 1e-6) {
    throw new AmountParseError(
      `"${nimInput}" does not convert to a whole number of Luna (NIM supports up to 5 decimal places)`,
    )
  }

  return Math.round(luna)
}

/** Formats an integer Luna amount as a display string, e.g. "20.00 NIM". */
export function formatLunaAsNim(luna: number): string {
  return `${(luna / LUNA_PER_NIM).toFixed(2)} NIM`
}
