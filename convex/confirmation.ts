'use node'

import { RPCServer } from '@nimiq/mini-app-sdk/provider'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction } from './_generated/server'
import { classifyTransactionResult, type GetTransactionByHashResult } from './lib/transactionResult'

const DEFAULT_POLL_INTERVAL_MS = 3_000
const DEFAULT_MAX_ATTEMPTS = 20 // 20 * 3s = 60s (PRD.md Section 5.4)

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * The sole writer of `confirmed_at`/`execution_result` (PRD.md Section 5.4,
 * ARCHITECTURE.md 2.3/2.4). Not client-callable — scheduled once, immediately,
 * by `recordBroadcast`. One invocation makes exactly one terminal write:
 * `paid`, or `failed` (either "included but failed" or "never included").
 *
 * Uses the real `RPCServer` from `@nimiq/mini-app-sdk`'s own `/provider`
 * export rather than reimplementing the JSON-RPC call — its `call()` method
 * is the one piece of verified-real code showing exactly how a Nimiq RPC
 * response unwraps (`{ result: { data: T } }`, `data` returned directly),
 * confirmed by reading the SDK's own bundled source rather than guessed.
 *
 * `pollIntervalMs`/`maxAttempts` are overridable only for tests — production
 * callers (`recordBroadcast`) never pass them, so real runs always use the
 * locked 3s/60s values.
 */
export const confirmationJob = internalAction({
  args: {
    participantId: v.id('participants'),
    eventId: v.id('payment_events'),
    txHash: v.string(),
    pollIntervalMs: v.optional(v.number()),
    maxAttempts: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rpcUrl = process.env.NIMIQ_RPC_URL
    if (!rpcUrl) {
      // Deliberately does NOT write `failed` here: this is an operator
      // configuration gap (DECISIONS.md #6 — no safe default exists), not a
      // fact about the transaction. The participant is left `broadcast`
      // rather than incorrectly recorded as a network-confirmed failure.
      throw new Error(
        'NIMIQ_RPC_URL is not configured on this Convex deployment (npx convex env set NIMIQ_RPC_URL <url>) — the confirmation job cannot run.',
      )
    }

    const pollIntervalMs = args.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    const maxAttempts = args.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
    const rpc = new RPCServer(rpcUrl)

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let result: GetTransactionByHashResult
      try {
        result = await rpc.call<GetTransactionByHashResult>({
          jsonrpc: '2.0',
          method: 'getTransactionByHash',
          params: [args.txHash],
        })
      } catch (err) {
        // A transient RPC/network failure is not a definitive answer from
        // the network — keep polling rather than treating one failed HTTP
        // call as proof of anything.
        console.error('[confirmationJob] getTransactionByHash call failed:', err)
        if (attempt < maxAttempts - 1) await sleep(pollIntervalMs)
        continue
      }

      const classification = classifyTransactionResult(result)

      if (classification.kind === 'included-success') {
        await ctx.runMutation(internal.paymentEvents.applyConfirmationResult, {
          participantId: args.participantId,
          eventId: args.eventId,
          outcome: { kind: 'paid' },
        })
        return
      }

      if (classification.kind === 'included-failed') {
        // Definitive network answer — act immediately, don't wait out the
        // rest of the timeout window (PRD.md Section 5.4).
        await ctx.runMutation(internal.paymentEvents.applyConfirmationResult, {
          participantId: args.participantId,
          eventId: args.eventId,
          outcome: { kind: 'failed', executionResult: false },
        })
        return
      }

      if (attempt < maxAttempts - 1) {
        await sleep(pollIntervalMs)
      }
    }

    // Timeout: never observed included within the window.
    await ctx.runMutation(internal.paymentEvents.applyConfirmationResult, {
      participantId: args.participantId,
      eventId: args.eventId,
      outcome: { kind: 'failed', executionResult: null },
    })
  },
})
