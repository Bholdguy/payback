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
- [x] Confirm `nimiq.isConsensusEstablished()` resolves inside Nimiq Pay — confirmed on real device, resolved `false` (the call itself succeeded, so Step 2's DoD — the call resolves — was genuinely met). **Correction from Step 5:** at the time this was read as fully non-blocking; it wasn't. A `false` result turned out to be the leading indicator of the exact wallet-sync failure that later blocked a real payment attempt in Step 5 (`DECISIONS.md` #9). `PayerView` does not yet gate the Pay button on this value — worth revisiting so a payer sees "wallet still syncing" up front instead of only after a failed send.
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

## Step 5 — Wallet-mediated payment action ⚠️ CODE DONE, DoD NOT FULLY MET (see note)

- [x] Build `src/nimiq/provider.ts`: wraps `init`, `listAccounts`, `isConsensusEstablished`, `getBlockNumber`, `sendBasicTransactionWithData`.
- [x] Build `PayerView.tsx`: reads frozen request via `getRequest`, renders verbatim (no local recomputation).
- [x] On tap pay: call `sendBasicTransactionWithData({ recipient: requester_wallet, value: share_amount_luna, data: memo })`.
- [x] Implement `recordBroadcast` mutation: writes `payment_events` row (`tx_hash`, `broadcast_at`, `confirmed_at = null`), flips `participants.status` to `broadcast`. Scoping note: there is no login/session anywhere in this system and `participants` has no payer-wallet binding field, so "own `participant_id`" is enforced as "a slot already broadcast/paid can't be re-claimed," not as per-caller identity — see `convex/paymentEvents.ts`.
- [x] Handle rejection: **revised per a real-device finding (`DECISIONS.md` #9)** — `PermissionDeniedError`/`InvalidTransactionError` are named on `nimiq.dev`'s API reference but exist in neither the installed SDK's source nor a confirmed real-device log. The trigger is now behavioral ("did not resolve with a tx hash"), not class-matched; no mutation call on a non-success outcome, UI falls back to retry.
- [x] Blocked-path UI: if opened outside Nimiq Pay, render a plain explainer instead of attempting `init()` and failing. — `isInsideNimiqPay()` checks `window.nimiq` synchronously, matching the SDK's own `init()` implementation.
- [ ] Test: approve path, reject path, invalid-transaction path all produce the correct state transition (`TESTING.md` Section 4) — confirm no path here ever writes `paid` directly.
  - [x] Reject path: confirmed on a real device (native "Confirm Transaction" dialog, explicit Reject button) — correct UI state, other participants unaffected, no false-paid. Exact rejected-value shape unverified (no remote debugging on that device); logged as a disclosed gap, not guessed at (`DECISIONS.md` #9).
  - [ ] Approve path on a real device: unit-tested via `convex-test` mocks (`convex/paymentEvents.test.ts`), but not yet confirmed with an actual wallet approval + `recordBroadcast` write on-device in this build.
  - [ ] Invalid-transaction / insufficient-balance path: deliberately skipped to avoid risking the funded testnet wallet with time remaining. Untested, not simulated — logged as an open gap (`DECISIONS.md` #9), not closed out.

**Status note:** the reject path's app-level behavior is confirmed correct on a real device, and the code is unit-tested end to end, but Step 5's Definition of Done ("all three SDK-level paths produce the correct state transition") is not yet fully met — the approve path hasn't been confirmed on-device in this build, and the invalid-transaction/insufficient-balance path is untested by deliberate choice. Treat as a known, disclosed gap rather than a pass.

## Step 6 — Status read-back (confirmation job) ⚠️ CODE + TESTS DONE, NEVER RUN AGAINST A REAL NETWORK

- [x] Implement `confirmationJob` as a Convex scheduled action, triggered immediately after `recordBroadcast` succeeds. — `convex/confirmation.ts` (`'use node'`), scheduled via `ctx.scheduler.runAfter(0, ...)` inside `recordBroadcast`.
- [x] Poll `getTransactionByHash(tx_hash)` against `NIMIQ_RPC_URL` every **3 seconds**, up to a **60-second** timeout (`PRD.md` Section 5.4 / `DECISIONS.md` #6 for the RPC endpoint requirement — this must be provisioned before this step can run against a real network). **Still not provisioned** — `npx convex env list` on the real deployment shows zero environment variables set. `confirmationJob` throws immediately in production right now (deliberately — see below), for every broadcast, until `npx convex env set NIMIQ_RPC_URL <url>` is run against a real value. Uses the SDK's own `RPCServer` (`@nimiq/mini-app-sdk/provider`) rather than a hand-rolled fetch, since its `call()` method is the one piece of verified-real code showing how a Nimiq RPC response actually unwraps (`{ result: { data: T } }`).
- [x] Response shape, per the official spec (`DECISIONS.md` #7, `nimiq.com/developers/build/set-up-your-own-node/rpc-docs`): `{ transaction: {...}, executionResult: boolean }`, with `transaction.blockNumber` present once included, absent while still in the mempool. — `convex/lib/transactionResult.ts`, pure and fully unit-tested in isolation from the polling loop.
- [x] Implement the **two-condition check**, not one — see `classifyTransactionResult`; confirmed correct by test for all three cases (not-included, included-success, included-failed), including that "included but failed" resolves on the very first poll rather than waiting out the timeout (asserted via fetch call-count, not just the end state).
- [x] On `paid`: set `payment_events.confirmed_at = now()` and `execution_result = true`. Confirm this is the *only* code path in the codebase that ever sets `confirmed_at`. — `applyConfirmationResult` internal mutation in `convex/paymentEvents.ts`; not client-callable.
- [x] On `failed` (either shape): set `execution_result = false` for included-but-failed, or leave it `null` for a timeout with no inclusion. — tested as two distinct cases.
- [x] Wire `getParticipantStatus` query so `PayerView` and `RequesterDashboard` both read live status from the same source. — `convex/paymentEvents.ts`; also surfaces `broadcastToConfirmedLatencyMs`, now displayed in `PayerView` next to "Paid".
- [x] UI: render three distinct visible states — "Pay" (`pending`), "Broadcasting…" (`broadcast`), "Paid" (`paid`) — never collapse `broadcast` into `paid` as an optimistic update. — unchanged from Step 5; already reads live Convex status, not an optimistic guess.
- [ ] Test: kill the app mid-confirmation, reopen, confirm the state shown is the true current Convex state, not a stale client guess (`TESTING.md` Section 4). — **not done**; requires a real running confirmation against a real device session, blocked on the same real-network gap below.
- [x] Test: assert `confirmed_at IS NOT NULL` for every paid-state test — never `tx_hash` or `broadcast_at` alone (`TESTING.md` hard assertion rule). — `convex/confirmation.test.ts`.
- [x] Test: `broadcast_to_confirmed_latency_ms` computes correctly and is always non-negative (`TESTING.md` Section 5). — same file.

**Two disclosed, separate blockers — neither closed, both must be before demo:**
1. **`NIMIQ_RPC_URL` has never been provisioned anywhere** (not `.env.local`, not the Convex deployment). This is a pre-existing gap from before Step 1 (`DECISIONS.md` #6), not something Step 6 introduced — but Step 6 is the first step that actually needs it to do anything real. Every real `recordBroadcast` right now schedules a `confirmationJob` that will immediately throw and leave the participant stuck at `broadcast` forever (deliberately — see the "config gap, not a transaction fact" test — but stuck is still stuck until this is set).
2. **The full approve → broadcast → confirmed loop has never run end to end against a real device or a real network**, per your note — deferred pending real NIM in the test wallet, tracked as a separate task. All of Step 6's logic is verified correct against mocked RPC responses (7 tests), but "correct against a mock" and "verified against Albatross" are different claims, and only the first is true right now.

## Step 7 — Failure handling and retry (targeted repair) ✅ DONE (against mocks; real-network retest still pending, same blockers as Step 6)

- [x] Catch rejection / confirmation-job timeout; render a clear, non-alarming "payment not completed, try again" state. — behavioral trigger, not class-matched, per Step 5's revised design (`DECISIONS.md` #9).
- [x] Implement retry: re-fires `sendBasicTransactionWithData()` with the identical frozen amount and memo, producing a **new `tx_hash`** and a **new `broadcast_at`**, written as a new `payment_events` row for the same `participant_id` — never reusing the old `tx_hash` (`PRD.md` Section 5.4 retry invariant). — held true by construction (`recordBroadcast` always inserts, never patches an existing event); confirmed by test, not just by design.
- [x] **Real gap found and fixed while closing out this step:** `PayerView` had no retry affordance when `participants.status === 'failed'` was set by the confirmationJob's timeout (Step 6) rather than by a same-session client-side error — a payer reopening the link after a timeout would see "Failed" with no way to act. Fixed: a Retry button now renders whenever `status === 'failed'`, regardless of local client state.
- [x] Confirm this does not conflict with the frozen-request invariant: retries apply to a transaction *attempt* (`payment_events`), never to the request or split (`requests`/`participants`). — untouched; no code path here writes to `requests`/`participants`' frozen fields.
- [x] Test: cancel → retry → approve; confirm final state is `paid` exactly once, and the earlier failed row's `confirmed_at` stays `null` permanently. — `convex/retry.test.ts`, simulating timeout-then-retry-then-confirm end to end; asserts both rows explicitly, not just the final status.
- [x] Test: one participant's failure never blocks or corrupts the other participants' state. — same file.

**Same disclosed blocker as Step 6:** all of the above is verified against mocked RPC responses; the retry flow has not been exercised against a real device or a real confirmation-job timeout in production (`NIMIQ_RPC_URL` still unset).

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
