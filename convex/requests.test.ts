import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.*s')

const REQUESTER_WALLET = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'

describe('createRequest / getRequest', () => {
  test('opening the same generated request twice returns identical frozen data (TESTING.md Section 2, cross-device read consistency)', async () => {
    const t = convexTest(schema, modules)

    const requestId = await t.mutation(api.requests.createRequest, {
      requesterWallet: REQUESTER_WALLET,
      total: 8_000_001,
      memo: 'Dinner at Taco Spot',
      participantCount: 4,
    })

    // Two independent reads, simulating two different devices opening the
    // same shared link.
    const first = await t.query(api.requests.getRequest, { requestId })
    const second = await t.query(api.requests.getRequest, { requestId })

    expect(first).toEqual(second)

    expect(first).not.toBeNull()
    expect(first!.request.total_amount).toBe(8_000_001)
    expect(first!.request.memo).toBe('Dinner at Taco Spot')
    expect(first!.request.participant_count).toBe(4)

    const shares = first!.participants.map((p) => p.share_amount).sort((a, b) => a - b)
    expect(shares).toEqual([2_000_000, 2_000_000, 2_000_000, 2_000_001])
    expect(first!.participants.every((p) => p.status === 'pending')).toBe(true)
  })

  test('createRequest re-runs the split server-side, ignoring a mismatched custom split (DECISIONS.md #8)', async () => {
    const t = convexTest(schema, modules)

    await expect(
      t.mutation(api.requests.createRequest, {
        requesterWallet: REQUESTER_WALLET,
        total: 8_000_000,
        memo: 'Bad split',
        customShares: [3_000_000, 4_000_000],
      }),
    ).rejects.toThrow()
  })

  test('a rejected createRequest call writes no requests or participants rows', async () => {
    const t = convexTest(schema, modules)

    await expect(
      t.mutation(api.requests.createRequest, {
        requesterWallet: REQUESTER_WALLET,
        total: 8_000_000,
        memo: 'Bad split',
        customShares: [3_000_000, 4_000_000],
      }),
    ).rejects.toThrow()

    const allRequests = await t.run((ctx) => ctx.db.query('requests').collect())
    const allParticipants = await t.run((ctx) => ctx.db.query('participants').collect())
    expect(allRequests).toHaveLength(0)
    expect(allParticipants).toHaveLength(0)
  })

  test('there is no updateRequest mutation exposed anywhere in the deployed API (PRD.md Section 5.5)', () => {
    expect('updateRequest' in api.requests).toBe(false)
  })
})
