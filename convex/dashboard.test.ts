import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.*s')

const WALLET_A = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
const WALLET_B = 'NQ11 1111 1111 1111 1111 1111 1111 1111 1111'

describe('listRequestsByWallet', () => {
  test('returns requests newest-first (DECISIONS.md #5)', async () => {
    const t = convexTest(schema, modules)

    const firstId = await t.mutation(api.requests.createRequest, {
      requesterWallet: WALLET_A,
      total: 1_000_000,
      memo: 'Yesterday',
      participantCount: 2,
    })
    const secondId = await t.mutation(api.requests.createRequest, {
      requesterWallet: WALLET_A,
      total: 2_000_000,
      memo: 'Five minutes ago',
      participantCount: 2,
    })

    const list = await t.query(api.requests.listRequestsByWallet, {
      requesterWallet: WALLET_A,
    })

    expect(list.map((r) => r.request._id)).toEqual([secondId, firstId])
  })

  test('never returns another wallet\'s requests (dashboard query scoping)', async () => {
    const t = convexTest(schema, modules)

    await t.mutation(api.requests.createRequest, {
      requesterWallet: WALLET_A,
      total: 1_000_000,
      memo: "A's request",
      participantCount: 2,
    })
    await t.mutation(api.requests.createRequest, {
      requesterWallet: WALLET_B,
      total: 2_000_000,
      memo: "B's request",
      participantCount: 2,
    })

    const listA = await t.query(api.requests.listRequestsByWallet, {
      requesterWallet: WALLET_A,
    })
    expect(listA).toHaveLength(1)
    expect(listA[0].request.memo).toBe("A's request")
  })

  test('computes paidCount/totalCount correctly for a mixed request', async () => {
    const t = convexTest(schema, modules)

    const requestId = await t.mutation(api.requests.createRequest, {
      requesterWallet: WALLET_A,
      total: 8_000_000,
      memo: 'Dinner at Taco Spot',
      participantCount: 4,
    })
    const { participants } = (await t.query(api.requests.getRequest, { requestId }))!

    await t.run((ctx) => ctx.db.patch(participants[0]._id, { status: 'paid', updated_at: Date.now() }))
    await t.run((ctx) => ctx.db.patch(participants[1]._id, { status: 'paid', updated_at: Date.now() }))

    const list = await t.query(api.requests.listRequestsByWallet, {
      requesterWallet: WALLET_A,
    })
    expect(list).toHaveLength(1)
    expect(list[0].paidCount).toBe(2)
    expect(list[0].totalCount).toBe(4)
  })

  test('two requests can be read independently and rendered side by side (compare view)', async () => {
    const t = convexTest(schema, modules)

    const idA = await t.mutation(api.requests.createRequest, {
      requesterWallet: WALLET_A,
      total: 1_000_000,
      memo: 'This month',
      participantCount: 2,
    })
    const idB = await t.mutation(api.requests.createRequest, {
      requesterWallet: WALLET_A,
      total: 3_000_000,
      memo: 'Last month',
      participantCount: 3,
    })

    const [a, b] = await Promise.all([
      t.query(api.requests.getRequest, { requestId: idA }),
      t.query(api.requests.getRequest, { requestId: idB }),
    ])

    expect(a!.request.memo).toBe('This month')
    expect(a!.participants).toHaveLength(2)
    expect(b!.request.memo).toBe('Last month')
    expect(b!.participants).toHaveLength(3)
  })
})
