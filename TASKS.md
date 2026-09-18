# Task Checklist — Payback

Open this file first in the implementation session. Ordered exactly by `PRD.md` Section 7's build steps. Every "Fill in" from the PRD is resolved — the decisions are in `DECISIONS.md`; this file just checklists the work.

Related docs, all self-contained: `PRD.md`, `ARCHITECTURE.md`, `SECURITY.md`, `TESTING.md`, `DEMO.md`, `DECISIONS.md`, `.env.example`.

---

## Step 1 — Lock the product contract

- [ ] Write `CONTRACT.md`: the product thesis (`PRD.md` Section 3) + the 8 owned jobs (`PRD.md` Section 1), in one paragraph.
- [ ] Confirm the contract fits in one paragraph.
- [ ] Confirm every teammate can repeat it from memory before writing any code.
- [ ] Confirm nothing outside the 8 jobs gets scheduled into a later step.

## Step 2 — Scaffold the Mini App ✅ DONE

- [x] `npm create vite@latest` with the React template (react-ts, to match `provider.ts` in `ARCHITECTURE.md`).
- [x] `npm install @nimiq/mini-app-sdk`.
- [x] Call `init({ timeout: 10_000 })` on app load.
- [x] Confirm `nimiq.listAccounts()` resolves inside Nimiq Pay — confirmed on real device, returned a real wallet address.
- [x] Confirm `nimiq.isConsensusEstablished()` resolves inside Nimiq Pay — confirmed on real device, resolved `false` (a valid state; the call itself succeeded).
- [x] Manual load test on a real device inside Nimiq Pay (`nimiq.dev/mini-apps/development/load-local-mini-app`) — done via the live Vercel deployment (`https://payback-jet.vercel.app`), not a tunnel.
- [x] Create the public GitHub repository, MIT license, named per the competition's open-source rule — `https://github.com/Bholdguy/payback`, MIT license confirmed by GitHub.

## Step 3 — Split calculator + request creation screen ✅ DONE

- [x] Implement `SplitCalculator` (pure, Luna-denominated — 1 NIM = 100,000 Luna, `PRD.md` Section 0): even split, custom shares. — `src/split/SplitCalculator.ts`
- [x] Apply the locked rounding rule (`DECISIONS.md` #1): remainder Luna go entirely to participant index 0.
- [x] Build `CreateRequest.tsx`: total, participant count, memo, generate button; live preview of per-person amount before generating. — `src/screens/CreateRequest.tsx` (as of Step 4, generate now persists via the real `createRequest` mutation)
- [x] Unit tests per `TESTING.md` Section 1 (even, uneven/remainder, single participant, zero/negative rejected, custom shares matching/not-matching total, determinism, safe-integer boundary). — `src/split/SplitCalculator.test.ts`, 12/12 passing (`npm test`)
- [x] Confirm remainder cents are never silently dropped (business-outcome assertion, not just "returns a number") — test asserts index 0 specifically receives the remainder AND the sum still equals the total.

## Step 4 — Request state + shareable link ✅ DONE

- [x] Set up Convex project; add `CONVEX_DEPLOYMENT` / `VITE_CONVEX_URL` locally (`.env.example`) — provider locked: Convex (`DECISIONS.md` #2). Real cloud dev deployment `bholdguyyy161:payback:main` (`stoic-squirrel-945.convex.cloud`) — not the CLI's anonymous local-only default, which would have been unreachable from a payer's phone.
- [x] Define `requests` and `participants` tables per `PRD.md` Section 9. — `convex/schema.ts`
- [x] Implement `createRequest` mutation: server-side `SplitCalculator` re-run (don't trust a client-computed split), writes both tables in one transaction, returns `request_id`. — `convex/requests.ts`
- [x] Implement `getRequest` query. — `convex/requests.ts`
- [x] Implement `RequestLinkGenerator`: both deeplink formats (`nimiqpay://miniapp?url=...` and `https://nimpay.app/miniapps/open/...`), using `VITE_APP_URL`. — `src/request/RequestLinkGenerator.ts`
- [x] Confirm no `updateRequest` mutation exists anywhere (the frozen-request invariant is enforced by absence of a write path — `SECURITY.md` Section 3). — asserted in `convex/requests.test.ts` against the generated API surface.
- [x] Test: opening the same link twice always shows the same frozen amount. — `convex/requests.test.ts`, plus verified manually against the real cloud deployment (`npx convex run`, two reads, byte-identical).
- [x] Test: link opened on a second device shows identical data. — same test; cross-device is simulated as two independent reads, which is what the frozen data model guarantees regardless of caller.

## Step 5 — Wallet-mediated payment action

- [ ] Build `src/nimiq/provider.ts`: wraps `init`, `listAccounts`, `isConsensusEstablished`, `getBlockNumber`, `sendBasicTransactionWithData`.
- [ ] Build `PayerView.tsx`: reads frozen request via `getRequest`, renders verbatim (no local recomputation).
- [ ] On tap pay: call `sendBasicTransactionWithData({ recipient: requester_wallet, value: share_amount_luna, data: memo })`.
- [ ] Implement `recordBroadcast` mutation: writes `payment_events` row (`tx_hash`, `broadcast_at`, `confirmed_at = null`), flips `participants.status` to `broadcast`. Scoped so a payer can only record their own `participant_id` (`ARCHITECTURE.md` Section 2.3).
- [ ] Handle `PermissionDeniedError` and `InvalidTransactionError` (both documented at `nimiq.dev/mini-apps/api-reference/nimiq-provider`) — no mutation call on either, UI falls back to retry.
- [ ] Blocked-path UI: if opened outside Nimiq Pay, render a plain explainer instead of attempting `init()` and failing.
- [ ] Test: approve path, reject path, invalid-transaction path all produce the correct state transition (`TESTING.md` Section 4) — confirm no path here ever writes `paid` directly.

## Step 6 — Status read-back (confirmation job)

- [ ] Implement `confirmationJob` as a Convex scheduled action, triggered immediately after `recordBroadcast` succeeds.
- [ ] Poll `getTransactionByHash(tx_hash)` against `NIMIQ_RPC_URL` every **3 seconds**, up to a **60-second** timeout (`PRD.md` Section 5.4 / `DECISIONS.md` #6 for the RPC endpoint requirement — this must be provisioned before this step can run against a real network).
- [ ] Response shape, per the official spec (`DECISIONS.md` #7, `nimiq.com/developers/build/set-up-your-own-node/rpc-docs`): `{ transaction: {...}, executionResult: boolean }`, with `transaction.blockNumber` present once included, absent while still in the mempool.
- [ ] Implement the **two-condition check**, not one: `blockNumber` present AND `executionResult === true` → `paid`. `blockNumber` present but `executionResult === false` → **included but failed** (fee charged, effect not applied, no value moved) → `failed` immediately, not a timeout. `blockNumber` absent for the full 60s window → `failed` on timeout.
- [ ] On `paid`: set `payment_events.confirmed_at = now()` and `execution_result = true`. Confirm this is the *only* code path in the codebase that ever sets `confirmed_at`.
- [ ] On `failed` (either shape): set `execution_result = false` for included-but-failed, or leave it `null` for a timeout with no inclusion — this distinction must be preserved in the row, not collapsed into one generic "failed."
- [ ] Wire `getParticipantStatus` query so `PayerView` and `RequesterDashboard` both read live status from the same source.
- [ ] UI: render three distinct visible states — "Pay" (`pending`), "Broadcasting…" (`broadcast`), "Paid" (`paid`) — never collapse `broadcast` into `paid` as an optimistic update.
- [ ] Test: kill the app mid-confirmation, reopen, confirm the state shown is the true current Convex state, not a stale client guess (`TESTING.md` Section 4).
- [ ] Test: assert `confirmed_at IS NOT NULL` for every paid-state test — never `tx_hash` or `broadcast_at` alone (`TESTING.md` hard assertion rule).
- [ ] Test: `broadcast_to_confirmed_latency_ms` computes correctly and is always non-negative (`TESTING.md` Section 5).

## Step 7 — Failure handling and retry (targeted repair)

- [ ] Catch `PermissionDeniedError` / `InvalidTransactionError` / confirmation-job timeout; render a clear, non-alarming "payment not completed, try again" state.
- [ ] Implement retry: re-fires `sendBasicTransactionWithData()` with the identical frozen amount and memo, producing a **new `tx_hash`** and a **new `broadcast_at`**, written as a new `payment_events` row for the same `participant_id` — never reusing the old `tx_hash` (`PRD.md` Section 5.4 retry invariant).
- [ ] Confirm this does not conflict with the frozen-request invariant: retries apply to a transaction *attempt* (`payment_events`), never to the request or split (`requests`/`participants`).
- [ ] Test: cancel → retry → approve; confirm final state is `paid` exactly once, and the earlier failed row's `confirmed_at` stays `null` permanently.
- [ ] Test: one participant's failure never blocks or corrupts the other participants' state.

## Step 8 — Requester dashboard (replay/compare)

- [ ] Implement `listRequestsByWallet` query, sorted **newest-first** (`DECISIONS.md` #5).
- [ ] Build `RequesterDashboard.tsx`: list view with paid/unpaid counts; detail view with full participant list and timestamps.
- [ ] Build the side-by-side compare view (two `getRequest` reads rendered together).
- [ ] Confirm this screen has zero mutation calls — read-only against Convex (`ARCHITECTURE.md` Section 2.1).
- [ ] Test: dashboard reflects a request created five minutes ago and one created yesterday identically, in newest-first order.
- [ ] Test: two requests render correctly side by side.

## Step 9 — Design pass

- [ ] Strip all wallet jargon ("gas," "consensus," "address") from payer-facing screens.
- [ ] One action per screen.
- [ ] Usability pass with a non-technical tester outside the build team; confirm they complete a payment unassisted.
- [ ] Fix any issues found before Step 10.

## Step 10 — Ship and open-source

- [ ] Pick a frontend hosting provider for the static Vite build (separate from Convex, which only hosts the backend). **This is not decided anywhere in the project** — pick one now; it doesn't affect any earlier step.
- [ ] Set `VITE_APP_URL` to the real deployed domain.
- [ ] Deploy frontend + Convex backend to production.
- [ ] Verify both deeplink formats open the app correctly on a real device: `nimiqpay://miniapp?url=...` and `https://nimpay.app/miniapps/open/...`.
- [ ] Cold-start test: a device that has never opened this Mini App before completes a payment on the first attempt.
- [ ] Confirm repo is public, MIT-licensed, and matches what's live.

## Step 11 — Deterministic judge demo

- [ ] Pre-fill the Plane 1 scenario inputs: 80 NIM, 4 participants, 20 NIM each, memo "Dinner at Taco Spot" (`DECISIONS.md` #3 — confirmed final).
- [ ] Confirm the presenting device day-of (`DECISIONS.md` #4 — not a blocker, but must be locked before rehearsal).
- [ ] Run the full script in `DEMO.md` (all 17 beats) end to end on the actual presenting device.
- [ ] Run it three consecutive times with identical outcomes (`PRD.md` Step 11 Definition of Done) — hard gate before presenting live.
- [ ] Confirm the "Broadcasting…" pause (`DEMO.md` beats 9–11) is never artificially shortened or lengthened — it must reflect real confirmation-job latency each rehearsal.

---

## Before starting Step 1

- [ ] Provision `NIMIQ_RPC_URL` (self-run Albatross node or a trusted third-party RPC provider) — required for Step 6 to run against a real network; no default exists (`DECISIONS.md` #6, `.env.example`).
- [ ] Set `NIMIQ_NETWORK` (testnet recommended for development; mainnet for the live judge demo).
- [ ] Create the Convex project and populate `.env.example` → `.env.local`.
