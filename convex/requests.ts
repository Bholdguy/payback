import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { splitCalculator } from '../src/split/SplitCalculator'

/**
 * Server-side split re-run (ARCHITECTURE.md 2.3): never trusts a
 * client-computed split. Writes `requests` + one `participants` row per
 * share in a single mutation — Convex mutations are transactional, so a
 * rejected split (e.g. mismatched custom shares, DECISIONS.md #8) leaves no
 * partial rows behind.
 *
 * There is no `updateRequest` mutation anywhere in this file, or the codebase
 * — the frozen-request invariant (PRD.md Section 5.5) is enforced by the
 * absence of a write path, not a convention.
 */
export const createRequest = mutation({
  args: {
    requesterWallet: v.string(),
    total: v.number(),
    memo: v.string(),
    participantCount: v.optional(v.number()),
    customShares: v.optional(v.array(v.number())),
  },
  handler: async (ctx, args) => {
    const hasParticipantCount = args.participantCount !== undefined
    const hasCustomShares = args.customShares !== undefined
    if (hasParticipantCount === hasCustomShares) {
      throw new Error('Provide exactly one of participantCount or customShares')
    }

    const shares = hasCustomShares
      ? splitCalculator({ total: args.total, customShares: args.customShares! })
      : splitCalculator({ total: args.total, participantCount: args.participantCount! })

    const requestId = await ctx.db.insert('requests', {
      requester_wallet: args.requesterWallet,
      total_amount: args.total,
      currency: 'NIM',
      memo: args.memo,
      participant_count: shares.length,
    })

    const now = Date.now()
    for (const share of shares) {
      await ctx.db.insert('participants', {
        request_id: requestId,
        share_amount: share,
        status: 'pending',
        updated_at: now,
      })
    }

    return requestId
  },
})

/**
 * Read-only. Renders exactly what's stored — no recomputation
 * (ARCHITECTURE.md 2.1, PRD.md Section 14 rule 3).
 */
export const getRequest = query({
  args: { requestId: v.id('requests') },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId)
    if (!request) return null

    const participants = await ctx.db
      .query('participants')
      .withIndex('by_request_id', (q) => q.eq('request_id', args.requestId))
      .collect()

    return { request, participants }
  },
})
