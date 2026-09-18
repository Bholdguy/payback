import { describe, expect, it } from 'vitest'
import { classifyTransactionResult } from './transactionResult'

describe('classifyTransactionResult', () => {
  it('is not-included while blockNumber is absent', () => {
    expect(classifyTransactionResult({ transaction: {}, executionResult: false })).toEqual({
      kind: 'not-included',
    })
  })

  it('is not-included when blockNumber is explicitly null', () => {
    expect(
      classifyTransactionResult({ transaction: { blockNumber: null }, executionResult: false }),
    ).toEqual({ kind: 'not-included' })
  })

  it('is included-success when blockNumber is present and executionResult is true', () => {
    expect(
      classifyTransactionResult({
        transaction: { blockNumber: 12345 },
        executionResult: true,
      }),
    ).toEqual({ kind: 'included-success' })
  })

  it('is included-failed when blockNumber is present and executionResult is false (DECISIONS.md #7)', () => {
    expect(
      classifyTransactionResult({
        transaction: { blockNumber: 12345 },
        executionResult: false,
      }),
    ).toEqual({ kind: 'included-failed' })
  })
})
