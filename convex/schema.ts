import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * PRD.md Section 9. `request_id`/`participant_id` and `created_at` are
 * Convex's own `_id`/`_creationTime` — not duplicated as separate fields.
 *
 * `payment_events` is Step 5's table, not added here (TASKS.md Step 4 scopes
 * this schema to `requests`/`participants` only).
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
})
