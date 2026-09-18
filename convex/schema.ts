import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * PRD.md Section 9. `request_id`/`participant_id`/`event_id` and `created_at`
 * are Convex's own `_id`/`_creationTime` — not duplicated as separate fields.
 */
export default defineSchema({
  requests: defineTable({
    requester_wallet: v.string(),
    total_amount: v.number(), // integer Luna, frozen once generated
    currency: v.literal('NIM'), // NIM only in v1 (PRD.md Section 0)
    memo: v.string(),
    participant_count: v.number(), // frozen once generated
  }).index('by_requester_wallet', ['requester_wallet']),

  participants: defineTable({
    request_id: v.id('requests'),
    share_amount: v.number(), // integer Luna, frozen at request creation
    status: v.union(
      v.literal('pending'),
      v.literal('broadcast'),
      v.literal('paid'),
      v.literal('failed'),
    ),
    updated_at: v.number(), // ms epoch, last status change
  }).index('by_request_id', ['request_id']),

  payment_events: defineTable({
    participant_id: v.id('participants'),
    tx_hash: v.string(),
    provider_result: v.string(), // raw SDK result/error, JSON-stringified, for audit
    broadcast_at: v.number(), // ms epoch, set when the SDK promise resolves
    // Written only by the Step 6 confirmationJob — never in the same write as
    // broadcast_at, never by this step's recordBroadcast (PRD.md Section 5.4).
    confirmed_at: v.union(v.number(), v.null()),
    execution_result: v.union(v.boolean(), v.null()),
  }).index('by_participant_id', ['participant_id']),
})
