import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.*s')

const REQUESTER_WALLET = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'

function mockRpcResponses(responses: unknown[]) {
  let call = 0
  const fetchMock = vi.fn(async () => {
    const body = responses[Math.min(call, responses.length - 1)]
    call++
    return { json: async () => ({ result: { data: body } }) }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
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

async function insertBroadcastEvent(
  t: ReturnType<typeof convexTest>,
  participantId: string,
  txHash: string,
  broadcastAt = Date.now(),
) {
  const eventId = await t.run((ctx) =>
    ctx.db.insert('payment_events', {
      participant_id: participantId as never,
      tx_hash: txHash,
      provider_result: JSON.stringify(txHash),
      broadcast_at: broadcastAt,
      confirmed_at: null,
      execution_result: null,
    }),
  )
  // Mirrors what recordBroadcast does in the real flow, so these
  // confirmationJob-only tests start from a realistic 'broadcast' state.
  await t.run((ctx) => ctx.db.patch(participantId as never, { status: 'broadcast', updated_at: broadcastAt }))
  return eventId
}

describe('confirmationJob', () => {
  beforeEach(() => {
    vi.stubEnv('NIMIQ_RPC_URL', 'https://example-rpc.test')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  test('writes paid + confirmed_at when blockNumber present and executionResult true (DECISIONS.md #7)', async () => {
    mockRpcResponses([{ transaction: { blockNumber: 100 }, executionResult: true }])
    const t = convexTest(schema, modules)
    const { participants } = await createFourWayRequest(t)
    const participant = participants[0]
    const eventId = await insertBroadcastEvent(t, participant._id, 'tx-1')

    await t.action(internal.confirmation.confirmationJob, {
      participantId: participant._id,
      eventId,
      txHash: 'tx-1',
      pollIntervalMs: 1,
      maxAttempts: 3,
    })

    const event = await t.run((ctx) => ctx.db.get(eventId))
    expect(event!.confirmed_at).not.toBeNull()
    expect(event!.execution_result).toBe(true)

    const updated = await t.run((ctx) => ctx.db.get(participant._id))
    expect(updated!.status).toBe('paid')
  })

  test('writes failed immediately (not waiting out the timeout) when included but executionResult is false — "included but failed"', async () => {
    mockRpcResponses([{ transaction: { blockNumber: 100 }, executionResult: false }])
    const t = convexTest(schema, modules)
    const { participants } = await createFourWayRequest(t)
    const participant = participants[0]
    const eventId = await insertBroadcastEvent(t, participant._id, 'tx-2')

    const fetchMock = vi.fn()
    // Reuse the same mock instance to count calls precisely.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchMock()
        return { json: async () => ({ result: { data: { transaction: { blockNumber: 100 }, executionResult: false } } }) }
      }),
    )

    await t.action(internal.confirmation.confirmationJob, {
      participantId: participant._id,
      eventId,
      txHash: 'tx-2',
      pollIntervalMs: 1,
      maxAttempts: 20,
    })

    // Definitive answer on the very first poll — must not have kept polling.
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const event = await t.run((ctx) => ctx.db.get(eventId))
    expect(event!.confirmed_at).toBeNull()
    expect(event!.execution_result).toBe(false)

    const updated = await t.run((ctx) => ctx.db.get(participant._id))
    expect(updated!.status).toBe('failed')
  })

  test('writes failed with execution_result null after exhausting all attempts with blockNumber never present (timeout)', async () => {
    mockRpcResponses([{ transaction: {}, executionResult: false }])
    const t = convexTest(schema, modules)
    const { participants } = await createFourWayRequest(t)
    const participant = participants[0]
    const eventId = await insertBroadcastEvent(t, participant._id, 'tx-3')

    await t.action(internal.confirmation.confirmationJob, {
      participantId: participant._id,
      eventId,
      txHash: 'tx-3',
      pollIntervalMs: 1,
      maxAttempts: 5,
    })

    const event = await t.run((ctx) => ctx.db.get(eventId))
    expect(event!.confirmed_at).toBeNull()
    expect(event!.execution_result).toBeNull() // distinct from "included but failed"

    const updated = await t.run((ctx) => ctx.db.get(participant._id))
    expect(updated!.status).toBe('failed')
  })

  test('confirms only on the poll where blockNumber first appears with executionResult true, not before (two-condition check)', async () => {
    mockRpcResponses([
      { transaction: {}, executionResult: false },
      { transaction: {}, executionResult: false },
      { transaction: { blockNumber: 42 }, executionResult: true },
    ])
    const t = convexTest(schema, modules)
    const { participants } = await createFourWayRequest(t)
    const participant = participants[0]
    const eventId = await insertBroadcastEvent(t, participant._id, 'tx-4')

    await t.action(internal.confirmation.confirmationJob, {
      participantId: participant._id,
      eventId,
      txHash: 'tx-4',
      pollIntervalMs: 1,
      maxAttempts: 5,
    })

    const event = await t.run((ctx) => ctx.db.get(eventId))
    expect(event!.confirmed_at).not.toBeNull()
    expect(event!.execution_result).toBe(true)
  })

  test('broadcast_to_confirmed_latency_ms is non-negative and derived from confirmed_at - broadcast_at (PRD.md Section 5.4 metric)', async () => {
    mockRpcResponses([{ transaction: { blockNumber: 1 }, executionResult: true }])
    const t = convexTest(schema, modules)
    const { participants } = await createFourWayRequest(t)
    const participant = participants[0]
    const broadcastAt = Date.now() - 5_000
    const eventId = await insertBroadcastEvent(t, participant._id, 'tx-5', broadcastAt)

    await t.action(internal.confirmation.confirmationJob, {
      participantId: participant._id,
      eventId,
      txHash: 'tx-5',
      pollIntervalMs: 1,
      maxAttempts: 3,
    })

    const status = await t.query(api.paymentEvents.getParticipantStatus, {
      participantId: participant._id,
    })
    expect(status!.broadcastToConfirmedLatencyMs).not.toBeNull()
    expect(status!.broadcastToConfirmedLatencyMs!).toBeGreaterThanOrEqual(0)
  })

  test('recordBroadcast schedules confirmationJob, which eventually flips status to paid end to end', async () => {
    mockRpcResponses([{ transaction: { blockNumber: 1 }, executionResult: true }])
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const { participants } = await createFourWayRequest(t)
    const participant = participants[0]

    await t.mutation(api.paymentEvents.recordBroadcast, {
      participantId: participant._id,
      txHash: 'tx-6',
      providerResult: '"tx-6"',
    })

    await t.finishAllScheduledFunctions(vi.runAllTimers)

    const updated = await t.run((ctx) => ctx.db.get(participant._id))
    expect(updated!.status).toBe('paid')
  })

  test('never sets confirmed_at when NIMIQ_RPC_URL is not configured — throws instead of guessing failed', async () => {
    vi.stubEnv('NIMIQ_RPC_URL', '')
    const t = convexTest(schema, modules)
    const { participants } = await createFourWayRequest(t)
    const participant = participants[0]
    const eventId = await insertBroadcastEvent(t, participant._id, 'tx-7')

    await expect(
      t.action(internal.confirmation.confirmationJob, {
        participantId: participant._id,
        eventId,
        txHash: 'tx-7',
        pollIntervalMs: 1,
        maxAttempts: 3,
      }),
    ).rejects.toThrow()

    const event = await t.run((ctx) => ctx.db.get(eventId))
    expect(event!.confirmed_at).toBeNull()
    const updated = await t.run((ctx) => ctx.db.get(participant._id))
    // Left as `broadcast`, not incorrectly marked `failed` — this is an
    // operator config gap, not a fact about the transaction.
    expect(updated!.status).toBe('broadcast')
  })
})
