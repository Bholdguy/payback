import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, mutation, query } from './_generated/server'

/**
 * Called once `sendBasicTransactionWithData()` resolves with a tx hash
 * (ARCHITECTURE.md 2.3). Writes exactly one `payment_events` row with
 * `confirmed_at = null` — that field is set only by Step 6's confirmationJob,
 * never here, never in the same write as `broadcast_at` (PRD.md Section 5.4).
 * Immediately schedules that job (delay 0), per ARCHITECTURE.md 2.4: it's
 * handed work once here, it never discovers work on its own.
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

    const eventId = await ctx.db.insert('payment_events', {
      participant_id: args.participantId,
      tx_hash: args.txHash,
      provider_result: args.providerResult,
      broadcast_at: now,
      confirmed_at: null,
      execution_result: null,
    })

    await ctx.db.patch(args.participantId, { status: 'broadcast', updated_at: now })

    await ctx.scheduler.runAfter(0, internal.confirmation.confirmationJob, {
      participantId: args.participantId,
      eventId,
      txHash: args.txHash,
    })
  },
})

/**
 * Written only by `confirmationJob` (`convex/confirmation.ts`) — not
 * client-callable. This is the only code path that can ever set
 * `confirmed_at`, per PRD.md Section 5.4 / ARCHITECTURE.md 2.3.
 */
export const applyConfirmationResult = internalMutation({
  args: {
    participantId: v.id('participants'),
    eventId: v.id('payment_events'),
    outcome: v.union(
      v.object({ kind: v.literal('paid') }),
      v.object({ kind: v.literal('failed'), executionResult: v.union(v.boolean(), v.null()) }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    if (args.outcome.kind === 'paid') {
      await ctx.db.patch(args.eventId, { confirmed_at: now, execution_result: true })
      await ctx.db.patch(args.participantId, { status: 'paid', updated_at: now })
    } else {
      await ctx.db.patch(args.eventId, { execution_result: args.outcome.executionResult })
      await ctx.db.patch(args.participantId, { status: 'failed', updated_at: now })
    }
  },
})

/**
 * ARCHITECTURE.md 2.1/2.3: the single source `PayerView` and
 * `RequesterDashboard` (Step 8) both read live participant status from.
 * Also surfaces `broadcast_to_confirmed_latency_ms` (PRD.md Section 5.4's
 * metric) once a participant is paid.
 */
export const getParticipantStatus = query({
  args: { participantId: v.id('participants') },
  handler: async (ctx, args) => {
    const participant = await ctx.db.get(args.participantId)
    if (!participant) return null

    const events = await ctx.db
      .query('payment_events')
      .withIndex('by_participant_id', (q) => q.eq('participant_id', args.participantId))
      .collect()

    const latestEvent = events.reduce<(typeof events)[number] | null>(
      (latest, e) => (!latest || e.broadcast_at > latest.broadcast_at ? e : latest),
      null,
    )

    return {
      participant,
      latestEvent,
      broadcastToConfirmedLatencyMs:
        latestEvent && latestEvent.confirmed_at !== null
          ? latestEvent.confirmed_at - latestEvent.broadcast_at
          : null,
    }
  },
})
