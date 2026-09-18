/**
 * Pure classification of a `getTransactionByHash` response, per PRD.md
 * Section 5.4 / DECISIONS.md #7's confirmed schema:
 * `{ transaction: {...}, executionResult: boolean }`, where
 * `transaction.blockNumber` is present once included, absent while still in
 * the mempool. Kept separate from the polling loop so the two-condition
 * check itself is trivially unit-testable without fetch, timers, or Convex.
 */
export interface GetTransactionByHashResult {
  transaction?: { blockNumber?: number | null } | null
  executionResult?: boolean
}

export type TransactionClassification =
  | { kind: 'not-included' }
  | { kind: 'included-success' }
  | { kind: 'included-failed' }

export function classifyTransactionResult(
  result: GetTransactionByHashResult,
): TransactionClassification {
  const blockNumber = result.transaction?.blockNumber
  if (blockNumber === undefined || blockNumber === null) {
    return { kind: 'not-included' }
  }
  return result.executionResult === true
    ? { kind: 'included-success' }
    : { kind: 'included-failed' }
}
