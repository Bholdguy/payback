/**
 * SplitCalculator — pure, Luna-denominated (1 NIM = 100,000 Luna, PRD.md Section 0).
 *
 * Rounding rule (DECISIONS.md #1): leftover Luna after an even split go entirely
 * to participant index 0, in requester-entry order. Never dropped, never
 * distributed fractionally.
 *
 * Custom-share mismatch rule (DECISIONS.md #8): a custom_shares array whose sum
 * doesn't exactly equal total_amount is rejected outright — never scaled,
 * truncated, or silently redistributed.
 */

export const LUNA_PER_NIM = 100_000

export class SplitCalculatorError extends Error {}

export interface EvenSplitInput {
  total: number
  participantCount: number
  customShares?: undefined
}

export interface CustomSplitInput {
  total: number
  customShares: number[]
  participantCount?: undefined
}

export type SplitCalculatorInput = EvenSplitInput | CustomSplitInput

function assertSafeIntegerAmount(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new SplitCalculatorError(
      `${label} must be a safe integer number of Luna, got ${value}`,
    )
  }
}

export function splitCalculator(input: SplitCalculatorInput): number[] {
  const { total } = input

  assertSafeIntegerAmount(total, 'total')
  if (total <= 0) {
    throw new SplitCalculatorError('total must be a positive number of Luna')
  }

  if (input.customShares !== undefined) {
    const { customShares } = input

    if (customShares.length === 0) {
      throw new SplitCalculatorError('customShares must not be empty')
    }

    let sum = 0
    for (const share of customShares) {
      assertSafeIntegerAmount(share, 'each custom share')
      if (share <= 0) {
        throw new SplitCalculatorError('each custom share must be a positive number of Luna')
      }
      sum += share
    }

    if (sum !== total) {
      throw new SplitCalculatorError(
        `customShares must sum exactly to total: expected ${total}, got ${sum}`,
      )
    }

    return [...customShares]
  }

  const { participantCount } = input
  assertSafeIntegerAmount(participantCount, 'participantCount')
  if (participantCount <= 0) {
    throw new SplitCalculatorError('participantCount must be a positive integer')
  }

  const base = Math.floor(total / participantCount)
  const remainder = total - base * participantCount

  const shares = new Array<number>(participantCount).fill(base)
  shares[0] += remainder

  return shares
}
