import { v } from 'convex/values'
import { mutation } from './_generated/server'

/**
 * Called once `sendBasicTransactionWithData()` resolves with a tx hash
 * (ARCHITECTURE.md 2.3). Writes exactly one `payment_events` row with
 * `confirmed_at = null` — that field is set only by Step 6's confirmationJob,
 * never here, never in the same write as `broadcast_at` (PRD.md Section 5.4).
 *
 * Scoping (ARCHITECTURE.md 2.3): there is no login/session in this system
 * (SECURITY.md Section 1), and `participants` carries no payer-wallet binding
 * — a payer identifies "their" participant by which frozen share they choose
 * to pay from the request they were shown, not by a credential this mutation
 * can check. What this mutation *can* and does enforce is that a slot already
 * claimed (broadcast or paid) can't be claimed again by a second caller.
 */
export const recordBroadcast = mutation({
  args: {
    participantId: v.id('participants'),
    txHash: v.string(),
    providerResult: v.string(),
  },
  handler: async (ctx, args) => {
    const participant = await ctx.db.get(args.participantId)
    if (!participant) {
      throw new Error('No such participant')
    }
    if (participant.status === 'broadcast' || participant.status === 'paid') {
      throw new Error(
        `Participant is already ${participant.status} — cannot record a new broadcast for a slot someone else already claimed`,
      )
    }

    const now = Date.now()

    await ctx.db.insert('payment_events', {
      participant_id: args.participantId,
      tx_hash: args.txHash,
      provider_result: args.providerResult,
      broadcast_at: now,
      confirmed_at: null,
      execution_result: null,
    })

    await ctx.db.patch(args.participantId, { status: 'broadcast', updated_at: now })
  },
})
