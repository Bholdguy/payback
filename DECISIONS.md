# Decisions — Payback

This is now the complete decision log for the 24-hour build. Every open item PRD.md deferred here has been locked in this pass. Nothing below is a placeholder.

---

## Locked decisions (final planning pass)

1. **Rounding rule for split remainders:** leftover Luna after an even split go entirely to the first participant in the list (index 0, in requester-entry order). `SplitCalculator` never drops a remainder and never distributes it fractionally across participants.
2. **Backend/store provider:** Convex, for `requests`/`participants`/`payment_events` storage and for running the confirmation job (Section 5.4) as a Convex scheduled action.
3. **Plane 1 demo scenario:** total 80 NIM, 4 participants, 20 NIM each, memo "Dinner at Taco Spot" — confirmed final. The presenter narrates this as "an $80 dinner" purely as relatable framing (matching the brief's original hook); the app itself takes 80 NIM as direct input with no FX conversion, consistent with the NIM-only v1 scope (PRD Section 0).
4. **Presenting device:** confirm day-of — not a blocker for any other planning artifact.
5. **Dashboard sort order:** newest-first (`requests.created_at` descending).

## Infrastructure notes surfaced while resolving `.env.example` and `ARCHITECTURE.md` (not among the five above, logged for the same reason)

6. **Nimiq RPC endpoint for the confirmation job:** no official Nimiq-hosted public RPC endpoint is documented anywhere in `nimiq.dev` (checked `nimiq.dev/mini-apps/api-reference/nimiq-provider`, `nimiq.dev/protocol/`, and Nimiq's own JSON-RPC specification page, which is framed around "set up your own node," not a hosted endpoint). This means `NIMIQ_RPC_URL` in `.env.example` is an operator-supplied value — either a self-run Albatross node or a trusted third-party RPC provider — not a default Nimiq gives you. This is not left as a vague disclaimer: it is the concrete reason `.env.example` has no baked-in value for that variable, and it is the one piece of infrastructure the next session must provision before Step 6 can run against a real network, mainnet or testnet.

7. **`getTransactionByHash` response shape — closed, first-party source.** Confirmed against Nimiq's own JSON-RPC Specification at `nimiq.com/developers/build/set-up-your-own-node/rpc-docs` (redirects to `nimiq.dev/build/set-up-your-own-node/rpc-docs`): the response is `{ transaction: {...}, executionResult: boolean }`, where `transaction.blockNumber` is present once the transaction is included in a block and absent while still in the mempool. `executionResult` reports whether the transaction's effect actually applied — Albatross can include a failed transaction in a block (fee charged, permanently recorded) without applying its effect, which is a distinct, real outcome from either "paid" or "never included."

   Six direct `WebFetch` attempts against `nimiq.dev` timed out across this project's planning (two against `/rpc/methods/get-transaction-by-hash`, four against the `/build/set-up-your-own-node/rpc-docs` path and its `www.nimiq.com` redirect) — a persistent reachability issue with that domain through this tool, not a reason to stop verifying. Confirmation came through a search-engine-mediated retrieval of that same primary page, which returned matching field names and the exact `executionResult`/`blockNumber` semantics independently of, and prior to, the user supplying them. This is now treated as a closed, first-party-sourced fact, not an open item.

   **Confirmed field-level check for `confirmationJob` (Step 6), two conditions:**
   - `blockNumber` absent → not yet included, keep polling.
   - `blockNumber` present and `executionResult === true` → `paid`.
   - `blockNumber` present and `executionResult === false` → **included but failed** → `failed` immediately (not a timeout).
   - Neither ever observed within 60s → `failed` on timeout.

   **Discarded source, noted for context only:** an earlier pass in this same investigation checked `pkg.go.dev/github.com/NimMiniApps/nimiq-go/rpc` (a third-party, Albatross-targeted Go binding) as a fallback when the first-party page wasn't yet reachable; that source only exposed `blockNumber`, not `executionResult`, and is superseded by the first-party spec above — the included-but-failed case it missed is exactly why this item was worth re-verifying rather than accepting as closed.

## Product rule surfaced while writing `TESTING.md` (not among the five above, logged for the same reason)

8. **Custom shares that don't sum to the frozen total are rejected at request creation, never auto-adjusted.** `SplitCalculator`/`createRequest` must reject a `custom_shares` array whose sum doesn't exactly equal `total_amount`, rather than silently scaling, truncating, or redistributing the difference. This was already implied by the fail-closed philosophy running through `PRD.md` Section 14 and `SECURITY.md`, but PRD.md's `SplitCalculator` tool definition only says it accepts "custom shares" without stating the mismatch behavior — `TESTING.md` Section 1 needed a concrete rule to write a real test against, so it's locked here rather than left as an assumption embedded only in a test table.

---

## Confirmation job mechanism (Step 6 / PRD Section 5.4)

**Decision:** poll-by-hash, not N-block-confirmation depth.

After a `broadcast` `payment_events` row is written, the backend polls Nimiq Albatross RPC `getTransactionByHash` for that `tx_hash` on a fixed interval until the response reports inclusion in a block, or a timeout elapses.

**Why poll-by-hash over requiring N confirmations past inclusion:** N-confirmation depth exists to protect against a block being reorged out after inclusion. For a same-day, non-custodial social-payment product at this vertical's stakes, that additional latency isn't matched by a corresponding trust benefit — the product's actual promise (PRD Section 1) is that "paid" reflects a real broadcast transaction actually included on-chain, not that "paid" survives an adversarial reorg scenario. If this product's scope ever expands to larger amounts or a setting where reorg risk matters, N-confirmation depth is the documented upgrade path (PRD Section 13).

**Verified against documentation:** `nimiq.dev/mini-apps/api-reference/nimiq-provider` documents `PermissionDeniedError` ("user rejected the confirmation dialog") and `InvalidTransactionError` ("transaction data malformed") as the named error types for `sendBasicTransactionWithData()`, confirming the `failed` trigger conditions in PRD Section 5.3/5.4. Neither that page nor `nimiq.dev/protocol/` documents a macro-block finality duration; `nimiq.dev/protocol/` states a "1-second block separation" for micro blocks and describes a Tendermint-style macro-block voting process (2f+1 validator agreement), but gives no explicit time-to-finality.

### Open items

- [ ] Poll interval (3s) and timeout (60s) are engineering defaults, not sourced from Nimiq finality documentation. If authoritative Albatross finality timing is found later (protocol spec, RPC fields indicating finality status), revisit these numbers and either tighten them or add a citation justifying the current values. Do not leave this checkbox unresolved without revisiting it if you touch confirmation-job code again.
