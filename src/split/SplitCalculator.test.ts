import { describe, expect, it } from 'vitest'
import { SplitCalculatorError, splitCalculator } from './SplitCalculator'

describe('SplitCalculator', () => {
  it('splits evenly when the total divides cleanly', () => {
    const shares = splitCalculator({ total: 8_000_000, participantCount: 4 })
    expect(shares).toEqual([2_000_000, 2_000_000, 2_000_000, 2_000_000])
  })

  it('gives the remainder Luna entirely to participant index 0 (DECISIONS.md #1)', () => {
    const shares = splitCalculator({ total: 8_000_001, participantCount: 4 })
    expect(shares[0]).toBe(2_000_001)
    expect(shares[1]).toBe(2_000_000)
    expect(shares[2]).toBe(2_000_000)
    expect(shares[3]).toBe(2_000_000)
    // Business-outcome assertion: the remainder is not merely present somewhere,
    // it is on index 0 specifically, and the sum still equals the total.
    expect(shares.reduce((a, b) => a + b, 0)).toBe(8_000_001)
  })

  it('gives the full total to a single participant', () => {
    const shares = splitCalculator({ total: 12_345, participantCount: 1 })
    expect(shares).toEqual([12_345])
  })

  it('rejects zero participants', () => {
    expect(() => splitCalculator({ total: 8_000_000, participantCount: 0 })).toThrow(
      SplitCalculatorError,
    )
  })

  it('rejects a zero total', () => {
    expect(() => splitCalculator({ total: 0, participantCount: 4 })).toThrow(
      SplitCalculatorError,
    )
  })

  it('rejects a negative total', () => {
    expect(() => splitCalculator({ total: -100, participantCount: 4 })).toThrow(
      SplitCalculatorError,
    )
  })

  it('rejects a negative participant count', () => {
    expect(() => splitCalculator({ total: 8_000_000, participantCount: -4 })).toThrow(
      SplitCalculatorError,
    )
  })

  it('accepts custom shares that sum exactly to the total, unchanged', () => {
    const shares = splitCalculator({ total: 8_000_000, customShares: [3_000_000, 5_000_000] })
    expect(shares).toEqual([3_000_000, 5_000_000])
  })

  it('rejects custom shares that do not sum to the total (DECISIONS.md #8) — never auto-adjusted', () => {
    expect(() =>
      splitCalculator({ total: 8_000_000, customShares: [3_000_000, 4_000_000] }),
    ).toThrow(SplitCalculatorError)
  })

  it('is deterministic across repeated calls with identical input', () => {
    const input = { total: 8_000_001, participantCount: 4 }
    const first = splitCalculator(input)
    const second = splitCalculator(input)
    expect(first).toEqual(second)
  })

  it('rejects a total that exceeds the safe integer boundary instead of silently truncating', () => {
    const unsafeTotal = Number.MAX_SAFE_INTEGER + 10
    expect(() =>
      splitCalculator({ total: unsafeTotal, participantCount: 4 }),
    ).toThrow(SplitCalculatorError)
  })

  it('handles a very large but still-safe total correctly', () => {
    const largeTotal = Number.MAX_SAFE_INTEGER - (Number.MAX_SAFE_INTEGER % 4)
    const shares = splitCalculator({ total: largeTotal, participantCount: 4 })
    expect(shares.reduce((a, b) => a + b, 0)).toBe(largeTotal)
    expect(shares[0]).toBe(shares[1])
  })
})
