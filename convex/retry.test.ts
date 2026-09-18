import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.*s')

const REQUESTER_WALLET = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'

function mockRpcResponse(response: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => ({ result: { data: response } }) })),
  )
}

async function createFourWayRequest(t: ReturnType<typeof convexTest>) {
  const requestId = await t.mutation(api.requests.createRequest, {
    requesterWallet: REQUESTER_WALLET,
    total: 8_000_000,
    memo: 'Dinner at Taco Spot',
    participantCount: 4,
  })
  const data = await t.query(api.requests.getRequest, { requestId })
  return { requestId, participants: data!.participants }
}

describe('retry invariant (PRD.md Section 5.4, TASKS.md Step 7)', () => {
  beforeEach(() => {
    vi.stubEnv('NIMIQ_RPC_URL', 'https://example-rpc.test')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  test('failed (timeout) -> retry -> approve ends with paid exactly once; two distinct payment_events rows; the first row\'s confirmed_at stays null permanently', async () => {
    const t = convexTest(schema, modules)
    const { participants } = await createFourWayRequest(t)
    const participant = participants[0]

    // First attempt: never included, times out to `failed`.
    mockRpcResponse({ transaction: {}, executionResult: false })
    await t.mutation(api.paymentEvents.recordBroadcast, {
      participantId: participant._id,
      txHash: 'tx-first-attempt',
      providerResult: '"tx-first-attempt"',
    })
    const events = await t.run((ctx) =>
      ctx.db
        .query('payment_events')
        .withIndex('by_participant_id', (q) => q.eq('participant_id', participant._id))
        .collect(),
    )
    const firstEventId = events[0]._id
    await t.action(internal.confirmation.confirmationJob, {
      participantId: participant._id,
      eventId: firstEventId,
      txHash: 'tx-first-attempt',
      pollIntervalMs: 1,
      maxAttempts: 3,
    })

    const afterTimeout = await t.run((ctx) => ctx.db.get(participant._id))
    expect(afterTimeout!.status).toBe('failed')

    // Retry: a brand-new sendBasicTransactionWithData call in the real app
    // produces a brand-new tx_hash — simulated here directly, since the SDK
    // call itself isn't part of this Convex-side test.
    mockRpcResponse({ transaction: { blockNumber: 999 }, executionResult: true })
    await t.mutation(api.paymentEvents.recordBroadcast, {
      participantId: participant._id,
      txHash: 'tx-retry-attempt',
      providerResult: '"tx-retry-attempt"',
    })
    const eventsAfterRetry = await t.run((ctx) =>
      ctx.db
        .query('payment_events')
        .withIndex('by_participant_id', (q) => q.eq('participant_id', participant._id))
        .collect(),
    )
    expect(eventsAfterRetry).toHaveLength(2)
    const retryEvent = eventsAfterRetry.find((e) => e.tx_hash === 'tx-retry-attempt')!
    expect(retryEvent.tx_hash).not.toBe('tx-first-attempt')

    await t.action(internal.confirmation.confirmationJob, {
      participantId: participant._id,
      eventId: retryEvent._id,
      txHash: 'tx-retry-attempt',
      pollIntervalMs: 1,
      maxAttempts: 3,
    })

    const finalParticipant = await t.run((ctx) => ctx.db.get(participant._id))
    expect(finalParticipant!.status).toBe('paid')

    const finalEvents = await t.run((ctx) =>
      ctx.db
        .query('payment_events')
        .withIndex('by_participant_id', (q) => q.eq('participant_id', participant._id))
        .collect(),
    )
    expect(finalEvents).toHaveLength(2)

    const finalFirstEvent = finalEvents.find((e) => e._id === firstEventId)!
    const finalRetryEvent = finalEvents.find((e) => e._id === retryEvent._id)!
    // Exactly one paid outcome, and the failed attempt's row is untouched.
    expect(finalFirstEvent.confirmed_at).toBeNull()
    expect(finalFirstEvent.execution_result).toBeNull()
    expect(finalRetryEvent.confirmed_at).not.toBeNull()
    expect(finalRetryEvent.execution_result).toBe(true)
  })

  test('one participant timing out to failed does not affect the other participants of the same request', async () => {
    const t = convexTest(schema, modules)
    const { participants } = await createFourWayRequest(t)

    mockRpcResponse({ transaction: {}, executionResult: false })
    await t.mutation(api.paymentEvents.recordBroadcast, {
      participantId: participants[0]._id,
      txHash: 'tx-fails',
      providerResult: '"tx-fails"',
    })
    const [event] = await t.run((ctx) =>
      ctx.db
        .query('payment_events')
        .withIndex('by_participant_id', (q) => q.eq('participant_id', participants[0]._id))
        .collect(),
    )
    await t.action(internal.confirmation.confirmationJob, {
      participantId: participants[0]._id,
      eventId: event._id,
      txHash: 'tx-fails',
      pollIntervalMs: 1,
      maxAttempts: 3,
    })

    const failedParticipant = await t.run((ctx) => ctx.db.get(participants[0]._id))
    expect(failedParticipant!.status).toBe('failed')

    for (const p of participants.slice(1)) {
      const fresh = await t.run((ctx) => ctx.db.get(p._id))
      expect(fresh!.status).toBe('pending')
    }
  })

  test('a participant can retry from a persisted failed status (not just a same-session client error)', async () => {
    const t = convexTest(schema, modules)
    const { participants } = await createFourWayRequest(t)
    const participant = participants[0]

    // Simulate a participant already `failed` from a prior session (no local
    // client state at all — this is what a fresh page load after a timeout
    // looks like).
    await t.run((ctx) => ctx.db.patch(participant._id, { status: 'failed', updated_at: Date.now() }))

    mockRpcResponse({ transaction: { blockNumber: 1 }, executionResult: true })
    await t.mutation(api.paymentEvents.recordBroadcast, {
      participantId: participant._id,
      txHash: 'tx-fresh-retry',
      providerResult: '"tx-fresh-retry"',
    })

    const updated = await t.run((ctx) => ctx.db.get(participant._id))
    expect(updated!.status).toBe('broadcast')
  })
})
