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

## Step 6 — Status read-back (confirmation job) ⚠️ CODE + TESTS DONE, RPC CONNECTIVITY NOW VERIFIED FOR REAL — SEE NETWORK-MISMATCH FLAG BELOW

- [x] Implement `confirmationJob` as a Convex scheduled action, triggered immediately after `recordBroadcast` succeeds. — `convex/confirmation.ts` (`'use node'`), scheduled via `ctx.scheduler.runAfter(0, ...)` inside `recordBroadcast`.
- [x] Poll `getTransactionByHash(tx_hash)` against `NIMIQ_RPC_URL` every **3 seconds**, up to a **60-second** timeout (`PRD.md` Section 5.4 / `DECISIONS.md` #6). **Now provisioned:** `https://rpc.nimiqwatch.com`, set in `.env.local` and on the Convex deployment. Verified reachable for real — see `DECISIONS.md` #6's update for the full end-to-end test (real request, real `recordBroadcast`, real 60s poll cycle against the live endpoint, correct `failed`/`execution_result: null` result, no config/connection error). Uses the SDK's own `RPCServer` (`@nimiq/mini-app-sdk/provider`) rather than a hand-rolled fetch, since its `call()` method is the one piece of verified-real code showing how a Nimiq RPC response actually unwraps (`{ result: { data: T } }`). **Rate-limited and explicitly not production-grade per Nimiq's own docs** — acceptable for this build, not a long-term choice.
- [x] Response shape, per the official spec (`DECISIONS.md` #7, `nimiq.com/developers/build/set-up-your-own-node/rpc-docs`): `{ transaction: {...}, executionResult: boolean }`, with `transaction.blockNumber` present once included, absent while still in the mempool. — `convex/lib/transactionResult.ts`, pure and fully unit-tested in isolation from the polling loop.
- [x] Implement the **two-condition check**, not one — see `classifyTransactionResult`; confirmed correct by test for all three cases (not-included, included-success, included-failed), including that "included but failed" resolves on the very first poll rather than waiting out the timeout (asserted via fetch call-count, not just the end state).
- [x] On `paid`: set `payment_events.confirmed_at = now()` and `execution_result = true`. Confirm this is the *only* code path in the codebase that ever sets `confirmed_at`. — `applyConfirmationResult` internal mutation in `convex/paymentEvents.ts`; not client-callable.
- [x] On `failed` (either shape): set `execution_result = false` for included-but-failed, or leave it `null` for a timeout with no inclusion. — tested as two distinct cases.
- [x] Wire `getParticipantStatus` query so `PayerView` and `RequesterDashboard` both read live status from the same source. — `convex/paymentEvents.ts`; also surfaces `broadcastToConfirmedLatencyMs`, now displayed in `PayerView` next to "Paid".
- [x] UI: render three distinct visible states — "Pay" (`pending`), "Broadcasting…" (`broadcast`), "Paid" (`paid`) — never collapse `broadcast` into `paid` as an optimistic update. — unchanged from Step 5; already reads live Convex status, not an optimistic guess.
- [ ] Test: kill the app mid-confirmation, reopen, confirm the state shown is the true current Convex state, not a stale client guess (`TESTING.md` Section 4). — **not done**; requires a real running confirmation against a real device session, blocked on the same real-network gap below.
- [x] Test: assert `confirmed_at IS NOT NULL` for every paid-state test — never `tx_hash` or `broadcast_at` alone (`TESTING.md` hard assertion rule). — `convex/confirmation.test.ts`.
- [x] Test: `broadcast_to_confirmed_latency_ms` computes correctly and is always non-negative (`TESTING.md` Section 5). — same file.

**Blockers, updated:**
1. ~~`NIMIQ_RPC_URL` has never been provisioned anywhere~~ — **resolved.** Set and verified reachable end to end against the live deployment (`DECISIONS.md` #6).
2. ~~Network mismatch (testnet config vs. mainnet RPC)~~ — **resolved.** Confirmed on the real device: this Nimiq Pay build has no testnet mode at all, only a mainnet balance and top-up address. `NIMIQ_NETWORK` corrected to `mainnet` in `.env.local`, matching reality and matching `rpc.nimiqwatch.com` (`DECISIONS.md` #6). **Consequence, not just a config edit:** every real device test from here forward, including the pending approve-path retest, spends real mainnet NIM — keep test amounts small.
3. **The full approve → broadcast → confirmed loop has still never run end to end against a real device** — the one remaining blocker, per your note, pending real NIM in the wallet. What's now proven for real: the RPC leg (real endpoint, real 60s poll, correct timeout result). What's still unproven: the wallet-approval leg, and the "included and confirmed" happy path against a real transaction — a genuinely broadcast-but-pending transaction has never been checked, only a hash that was never broadcast at all (`DECISIONS.md` #6's "one nuance" note).
4. ~~Test data left on the real deployment~~ — **fully resolved (Step 10 pass).** The "RPC connectivity test" request, a leftover Step 4 CLI test, and 4 of the 6 "Dinner at Taco Spot" device-test requests are all deleted (same temporary-mutation-then-remove pattern each time, no permanent delete capability added). 2 "Dinner at Taco Spot" requests deliberately kept, so the dashboard's compare view has realistic data during Step 11 rehearsals instead of showing empty.

## Step 7 — Failure handling and retry (targeted repair) ✅ DONE (against mocks; real-network retest still pending, same blockers as Step 6)

- [x] Catch rejection / confirmation-job timeout; render a clear, non-alarming "payment not completed, try again" state. — behavioral trigger, not class-matched, per Step 5's revised design (`DECISIONS.md` #9).
- [x] Implement retry: re-fires `sendBasicTransactionWithData()` with the identical frozen amount and memo, producing a **new `tx_hash`** and a **new `broadcast_at`**, written as a new `payment_events` row for the same `participant_id` — never reusing the old `tx_hash` (`PRD.md` Section 5.4 retry invariant). — held true by construction (`recordBroadcast` always inserts, never patches an existing event); confirmed by test, not just by design.
- [x] **Real gap found and fixed while closing out this step:** `PayerView` had no retry affordance when `participants.status === 'failed'` was set by the confirmationJob's timeout (Step 6) rather than by a same-session client-side error — a payer reopening the link after a timeout would see "Failed" with no way to act. Fixed: a Retry button now renders whenever `status === 'failed'`, regardless of local client state.
- [x] Confirm this does not conflict with the frozen-request invariant: retries apply to a transaction *attempt* (`payment_events`), never to the request or split (`requests`/`participants`). — untouched; no code path here writes to `requests`/`participants`' frozen fields.
- [x] Test: cancel → retry → approve; confirm final state is `paid` exactly once, and the earlier failed row's `confirmed_at` stays `null` permanently. — `convex/retry.test.ts`, simulating timeout-then-retry-then-confirm end to end; asserts both rows explicitly, not just the final status.
- [x] Test: one participant's failure never blocks or corrupts the other participants' state. — same file.

**Same disclosed blocker as Step 6:** all of the above is verified against mocked RPC responses; the retry flow has not been exercised against a real device or a real confirmation-job timeout in production (`NIMIQ_RPC_URL` still unset).

## Step 8 — Requester dashboard (replay/compare) ✅ DONE

- [x] Implement `listRequestsByWallet` query, sorted **newest-first** (`DECISIONS.md` #5). — `convex/requests.ts`; also returns `paidCount`/`totalCount` per request (computed server-side, avoiding an N+1 client-side fetch) since the list view needs them.
- [x] Build `RequesterDashboard.tsx`: list view with paid/unpaid counts; detail view with full participant list and timestamps. — reachable at `/dashboard`; per-participant rows use `getParticipantStatus` (Step 6) to show broadcast/confirmed timestamps and latency once paid.
- [x] Build the side-by-side compare view (two `getRequest` reads rendered together). — selecting two requests (checkboxes) renders both `RequestDetail` panels side by side; selecting a third slides the selection window rather than growing past two.
- [x] Confirm this screen has zero mutation calls — read-only against Convex (`ARCHITECTURE.md` Section 2.1). — verified by grep; no `useMutation` anywhere in `RequesterDashboard.tsx`.
- [x] Test: dashboard reflects a request created five minutes ago and one created yesterday identically, in newest-first order. — `convex/dashboard.test.ts`.
- [x] Test: two requests render correctly side by side. — same file; each `getRequest` read verified independent and correct.
- Extracted `useRequesterWallet()` (`src/nimiq/useRequesterWallet.ts`) out of `CreateRequest.tsx`, now shared with `RequesterDashboard.tsx` — same wallet-detection logic, not duplicated a second time.

## Step 9 — Design pass ⚠️ VISUAL/COPY WORK DONE, USABILITY TEST BLOCKED ON WALLET FUNDING

- [x] Strip all wallet jargon ("gas," "consensus," "address") from payer-facing screens — applied to all three screens, not just payer-facing, per explicit instruction. No raw address string is shown anywhere in normal rendering (`formatAddressShort` truncates it, framed as "Requested by," never "wallet"/"address"); error copy reworded off "wallet" terminology. "Broadcasting…" is kept verbatim — that's a PRD.md Section 5.3-locked exact label, not jargon to remove.
- [x] One action per screen — true for `CreateRequest` (single "Request" button; the "Your requests" link is a de-emphasized nav link, not a competing call to action) and its post-generate confirmation ("Share link" primary, "Back" secondary). **Not fully true for `PayerView`**: each participant row carries its own Pay/Retry action, since the data model has no participant-to-device binding (nobody's slot is "yours" until you tap it) — collapsing that to one literal button would mean redesigning the participant-claiming model itself, out of scope for a visual design pass. `RequesterDashboard` is a browse/compare screen by its own stated purpose (Experience C), not a single-action screen, and wasn't forced into that shape.
- [x] Replaced the inline-style, unstyled markup across all three screens with a shared design system (`src/index.css`): consistent typography scale, card/button/status components, spacing, light/dark mode. Mobile-first (`max-width: 480px`), matching a WebView Mini App rather than the prior desktop-marketing-page leftover from the Vite scaffold.
- [x] Step 5's on-screen debug panel is no longer visible by default — gated behind an explicit `?debug=1` query parameter (`DEBUG_ENABLED` in `PayerView.tsx`) rather than deleted outright, since it may still be needed for the pending real-device retest. A real user or judge opening the plain shared link will never see it. Flagged as a judgment call: this is a query-param gate, not a strict `import.meta.env.DEV` build-time gate, specifically so it stays available on the same production URL for troubleshooting.
- [ ] Usability pass with a non-technical tester outside the build team; confirm they complete a payment unassisted. **Blocked on wallet funding**, same as Step 5's approve-path retest — a real, non-technical tester cannot complete a real payment against an unfunded wallet. Left unmarked deliberately.
- [ ] Fix any issues found before Step 10. — depends on the usability pass above; nothing to fix yet since it hasn't run.

## Step 10 — Ship and open-source ⚠️ PARTIALLY DONE — SEE TWO DISTINCT BLOCKERS BELOW

- [x] Pick a frontend hosting provider for the static Vite build. — **Vercel**, resolved (`DECISIONS.md` #10). Not a fresh choice made now — it's been the live URL since Step 2.
- [x] Set `VITE_APP_URL` to the real deployed domain. — `https://payback-jet.vercel.app`, set in `.env.local` and as a Vercel production env var since Step 4.
- [x] Deploy frontend + Convex backend to production. — both live and have been redeployed at every step since.
- [ ] Verify both deeplink formats open the app correctly on a real device: `nimiqpay://miniapp?url=...` and `https://nimpay.app/miniapps/open/...`. **Not both verifiable yet, and not for the same reason:**
  - `https://nimpay.app/miniapps/open/...` — **confirmed broken right now**, independent of any device or wallet. Direct HTTP test against the real production link returns 404 "Unknown mini app host": the app isn't listed in Nimiq's Mini Apps directory yet. Fix is an external PR (`nimiq/awesome`'s `src/data/nimiq-mini-apps.json`), not a code change here (`DECISIONS.md` #11).
  - `nimiqpay://miniapp?url=...` — per Nimiq's own docs, should work today without directory listing (one-time warning, then full SDK access) — but this couldn't be tested in this environment (no device capable of invoking a custom URI scheme). This is a *device* blocker, distinct from wallet funding — it doesn't need a funded wallet, just a phone with Nimiq Pay installed.
- [ ] Cold-start test: a device that has never opened this Mini App before completes a payment on the first attempt. — **blocked on wallet funding**, same as Step 5/9's pending real-device checks. Left deliberately unmarked.
- [x] Confirm repo is public, MIT-licensed, and matches what's live. — `https://github.com/Bholdguy/payback`, confirmed public and MIT-licensed at Step 2; kept in sync with every deploy since.

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
