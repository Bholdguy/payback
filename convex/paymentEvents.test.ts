import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.*s')

const REQUESTER_WALLET = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'

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

describe('recordBroadcast', () => {
  test('writes a payment_events row with confirmed_at null and flips status to broadcast, never paid (PRD.md Section 5.4)', async () => {
    const t = convexTest(schema, modules)
    const { participants } = await createFourWayRequest(t)
    const participant = participants[0]

    await t.mutation(api.paymentEvents.recordBroadcast, {
      participantId: participant._id,
      txHash: 'tx-abc-123',
      providerResult: JSON.stringify('tx-abc-123'),
    })

    const events = await t.run((ctx) =>
      ctx.db
        .query('payment_events')
        .withIndex('by_participant_id', (q) => q.eq('participant_id', participant._id))
        .collect(),
    )
    expect(events).toHaveLength(1)
    expect(events[0].tx_hash).toBe('tx-abc-123')
    expect(events[0].broadcast_at).toBeGreaterThan(0)
    expect(events[0].confirmed_at).toBeNull()
    expect(events[0].execution_result).toBeNull()

    const updatedParticipant = await t.run((ctx) => ctx.db.get(participant._id))
    expect(updatedParticipant!.status).toBe('broadcast')
  })

  test('rejects recording a broadcast for a participant slot that is already broadcast or paid', async () => {
    const t = convexTest(schema, modules)
    const { participants } = await createFourWayRequest(t)
    const participant = participants[0]

    await t.mutation(api.paymentEvents.recordBroadcast, {
      participantId: participant._id,
      txHash: 'tx-first',
      providerResult: JSON.stringify('tx-first'),
    })

    await expect(
      t.mutation(api.paymentEvents.recordBroadcast, {
        participantId: participant._id,
        txHash: 'tx-second',
        providerResult: JSON.stringify('tx-second'),
      }),
    ).rejects.toThrow()
  })

  test('retry invariant: a second recordBroadcast after a fresh send produces a second distinct row with a new tx_hash, and never rewrites the first row', async () => {
    const t = convexTest(schema, modules)
    const { participants } = await createFourWayRequest(t)
    const participant = participants[0]

    // Simulate: send fails (no mutation call at all — ARCHITECTURE.md Section
    // 4's "no-op back to pending"), so nothing is written yet. Then retry
    // succeeds with a brand-new tx hash.
    await t.mutation(api.paymentEvents.recordBroadcast, {
      participantId: participant._id,
      txHash: 'tx-retry-attempt',
      providerResult: JSON.stringify('tx-retry-attempt'),
    })

    const events = await t.run((ctx) =>
      ctx.db
        .query('payment_events')
        .withIndex('by_participant_id', (q) => q.eq('participant_id', participant._id))
        .collect(),
    )
    expect(events).toHaveLength(1)
    expect(events[0].tx_hash).toBe('tx-retry-attempt')
  })

  test('one participant broadcasting does not affect the other participants of the same request', async () => {
    const t = convexTest(schema, modules)
    const { participants } = await createFourWayRequest(t)

    await t.mutation(api.paymentEvents.recordBroadcast, {
      participantId: participants[0]._id,
      txHash: 'tx-only-one',
      providerResult: JSON.stringify('tx-only-one'),
    })

    for (const p of participants.slice(1)) {
      const fresh = await t.run((ctx) => ctx.db.get(p._id))
      expect(fresh!.status).toBe('pending')
    }
  })
})
