# Payback — Product Requirements Document

Nimiq Mini Apps Cycle II · Draft v1 · 2026-09-17
Source: `Payback — Product & Build Brief (Nimiq Mini Apps Cycle II).pdf`, verified against current `nimiq.dev/mini-apps` documentation on 2026-09-17.

---

## 0. SDK verification note (read this before anything else)

The brief (Section 7, Step 5) assumes a distinct "payment-request method" on the Nimiq provider that returns a structured confirmation event. **That method does not exist under that description.** Current documentation (`nimiq.dev/mini-apps/api-reference/nimiq-provider`, `nimiq.dev/mini-apps/tutorials/mini-app-tutorial`) confirms the following instead:

| Brief assumption | Verified reality | Impact |
|---|---|---|
| A "payment-request method" returning a rich provider event | `sendBasicTransactionWithData({ recipient, value, data, fee?, validityStartHeight? })` — triggers the native approval dialog, resolves to a **transaction hash string** on approval, or throws `PermissionDeniedError` (user rejected) / `InvalidTransactionError` (malformed or unpayable tx) | Status read-back cannot rely on a rich "provider result object" (Section 4's `PaymentStatusReader`). It must be built from a tx hash + independent chain lookup. See below. |
| `value` implied to be a decimal currency amount | `value` is an **integer in Luna** (1 NIM = 100,000 Luna) | `SplitCalculator` and `AmountFormatter` must convert to/from Luna at the provider boundary; all internal math is done in Luna to avoid float rounding. |
| Provider event distinguishes "cancelled" vs "insufficient balance" | SDK exposes only two error types (`PermissionDeniedError`, `InvalidTransactionError`); no documented third state | The app cannot reliably tell "user tapped cancel" apart from "wallet rejected for balance reasons" from the SDK alone. Both are treated identically: **not paid, offer retry.** |
| Promise resolution = wallet-confirmed on-chain payment | Promise resolution = **user approved and the wallet broadcast the transaction.** Documentation does not state the promise waits for on-chain inclusion. | A returned tx hash is necessary but not sufficient for "paid." The app performs an independent confirmation check against the Nimiq Albatross network before writing a `paid` status. See Section 5.3. |
| USDT-L2 available through the same call as NIM | USDT-L2 / other tokens go through **EVM chains via `window.ethereum`**, a separate provider from the native Nimiq `sendBasicTransactionWithData` path | Out of scope for the 24-hour build. **NIM is the only supported currency in v1.** USDT-L2 is deferred (Section 13/DECISIONS.md). |
| — | `listAccounts()`, `isConsensusEstablished()`, `getBlockNumber()` are confirmed read-only provider methods; `init({ timeout })` confirmed as the SDK entry point | Used as documented, unchanged from the brief. |
| — | Deeplink formats confirmed: `nimiqpay://miniapp?url=<domain>` and `https://nimpay.app/miniapps/open/<domain>` | Matches brief Section 7 Step 10 exactly; no pivot needed. |
| — | `requestDeviceIdentifier()` confirmed to exist (pseudonymous per-device SHA-256 id) | Available for the Section 13 leaderboard extension only; not used in v1. |

**Consequence for the product contract:** "wallet-confirmed payment status, never inferred" (Section 1, job 5) is implemented as a two-stage fact, not a single event:

1. **Approval stage** — `sendBasicTransactionWithData()` resolves with a tx hash. This proves the user approved and the wallet broadcast the transaction. Recorded as `broadcast`.
2. **Confirmation stage** — the backend independently queries the Nimiq network (Albatross RPC `getTransactionByHash`, or a hosted equivalent) for that tx hash until it reports inclusion. Only then is the participant status flipped to `paid`.

This is *more* conservative than the brief's original design, not less — it closes a gap the brief didn't know existed (a broadcast tx can still fail to confirm). Full mechanics in Section 5.3/5.4 and `ARCHITECTURE.md`.

All other product, UX, and scope decisions in the brief are unaffected and are carried through unchanged below.

---

## 1. Why this should be built

A payment demo that moves NIM from wallet A to wallet B proves the SDK works. It proves nothing about whether the product solves a real problem. The demo-vs-production gap: does the app correctly compute and preserve the facts that make a group payment trustworthy, or does it quietly get one of them wrong the way every existing tool already does?

**The facts that break trust if wrong:**

- **Total amount** — if miscalculated, someone overpays or underpays without noticing until later.
- **Per-person share** — an off-by-one split (4 people, one drops out) must recompute cleanly, not silently.
- **Payment status** — showing "paid" before the network actually confirms it turns the app into the honor-system ledger (Splitwise, a spreadsheet) people already distrust.
- **Requester identity** — a payer must be certain who they are paying before they approve.

If any of these are wrong, the app becomes one more thing to double-check, defeating the premise: replacing "I'll Venmo you later, I promise" with a single approved transaction.

**The product owns 8 jobs** (this is the entire scope — nothing outside this list gets built in the 24-hour window):

1. Computing an even or custom split from a total and participant count
2. Generating one shareable, non-editable payment request per split
3. Surfacing the exact amount owed to each participant, tied to a memo
4. Triggering the Nimiq Pay native approval dialog for each payer
5. Reading back wallet-confirmed payment status through the Nimiq provider **plus independent chain confirmation** (see Section 0), never inferring it
6. Tracking paid/unpaid state per participant for a single request
7. Handling a participant who cancels or abandons the flow without corrupting other participants' state
8. Distinguishing a requester from payers without requiring either to create an account

---

## 2. Why this fits the hackathon

Nimiq's scoring rubric covers five categories: functionality, Nimiq Pay integration, real usage, design, builder promotion.

| Judging category | How Payback maps |
|---|---|
| Functionality | Full loop end to end: create request → split → shareable link → native approval → confirmed status |
| Nimiq Pay integration | `sendBasicTransactionWithData()` and the native approval dialog ARE the core mechanic, not a button bolted onto a generic web app |
| Real usage | Solves a documented complaint pattern (bill-splitting, roommate/utility disputes), not an invented crypto use case |
| Design | One clear screen per role (requester vs payer), no wallet jargon exposed |
| Builder promotion | Demoable in under 60 seconds; one-sentence pitch for a launch thread |

**What this must not be the frame of:**
- A generic crypto tip jar with no sourced problem behind it
- A Splitwise clone that only tracks debt without ever moving money
- A P2P marketplace with escrow and dispute resolution (explicitly out of scope, Section 12 of the brief)

The sponsor primitive is structural: strip out the Mini App SDK and this collapses into a Venmo-request screenshot — exactly the status quo the research shows people distrust.

---

## 3. Core thesis

**Product thesis.** Unsettled social debt (a dinner bill, a rent split, an informal favor) doesn't stay unpaid because people don't want to pay. It stays unpaid because paying requires a manual context switch to an app that isn't already open, and tracking who paid is manual and easy to fudge or forget. Collapsing the request and the payment into one native, in-context tap removes that switch entirely.

**Technical thesis.** The Nimiq Pay Mini App SDK lets a lightweight webview request a wallet-mediated NIM payment behind a native, user-approved confirmation dialog (`sendBasicTransactionWithData`), then verify the result against the Nimiq network, without the app ever touching a private key, running its own payment rail, or asking the user to leave the app they're already in.

**Business thesis.** The Nimiq Mini Apps Framework carries no submission fees, platform commissions, or revenue sharing. This product is genuinely free for both requester and payer — a real differentiator against Patreon-style platform cuts, Venmo's business-payment fees, and multi-day payout holds.

---

## 4. The reference vertical

**Vertical:** group and social payment requests — dining, roommate/utility bills, informal debts, and (as edge cases of the same mechanic) creator tips and freelance invoices.

### Critical entity types

- **Request** — a total, a memo, and one or more participants
- **Participant** — a share amount and a payment status
- **PaymentEvent** — a broadcast tx hash and (once independently verified) a confirmed status, tied to one participant and one request
- **Requester** — the creator of a request, identified only by wallet address, no account

### Deterministic business tools (typed)

| Tool | Input | Output |
|---|---|---|
| `SplitCalculator` | total (Luna), participant count or custom shares | per-person amount (Luna), deterministic remainder allocation |
| `RequestLinkGenerator` | request id | shareable URL (`nimiqpay://miniapp?url=...` and HTTPS equivalent) |
| `PaymentStatusReader` | participant id | current status (`pending` \| `broadcast` \| `paid` \| `failed`), sourced from a stored `payment_events` row, never inferred client-side |
| `AmountFormatter` | raw Luna amount, currency (NIM only in v1) | display string (e.g. "20.00 NIM") |

### Seeded data / backend requirement

A minimal shared backend is **required, not optional.** The requester and payer are almost always on two different devices; client-side-only storage (`localStorage`) cannot let the requester's dashboard see a payer's confirmation. A single key-value or document store keyed by `request_id`, written on payment confirmation and read by the requester's dashboard, is the ceiling — not a full relational schema. (Chosen provider documented in `DECISIONS.md`.)

### Out of scope for the demo

Subscription billing, marketplace escrow and dispute resolution, multi-currency FX conversion, KYC/AML, cross-chain swaps, USDT-L2 (see Section 0).

---

## 5. The two-plane model

No ML or repair-and-learn loop exists in this product, so the planes are adapted from a reliability-layer frame to a payments frame: a fixed demo scenario versus the general engine it runs on.

### 5.1 Plane 1 — reference workload

A single seeded demo scenario: "Dinner at [Restaurant], 4 people, $80 total" (expressed internally as an NIM-denominated total; see `DECISIONS.md` for the demo's fixed NIM amount, since the brief's dollar figure is illustrative and NIM has no fixed USD peg).

- **May:** pre-fill inputs so a judge isn't typing from scratch; run in a scripted, rehearsed order.
- **Must not:** hardcode a "paid" status anywhere the real provider/network result should render; skip the actual wallet approval step; fake a transaction that never touched the Nimiq provider or the network.

### 5.2 Plane 2 — the actual product

The general Request → Split → Link → Approve → Status loop, working for any total, any participant count, any memo, through the **exact same code path** the demo scenario uses.

- **Must:** read every status from a stored `payment_events` row backed by a real `sendBasicTransactionWithData` result and independent network confirmation; treat every request identically regardless of amount.
- **Must not:** silently mutate a participant's owed amount after a request is generated; show "paid" without both a broadcast tx hash and a confirmed on-chain lookup.

### 5.3 Status state machine (new — required by Section 0's SDK findings)

The brief specified only `pending` / `paid` / `failed`. Given that `sendBasicTransactionWithData` resolving is *approval*, not *confirmation*, the implementation needs an intermediate state:

```
pending  →  broadcast  →  paid
   |            |
   └──────→  failed  ←────┘
```

- `pending` — request generated, no payment attempt yet, or a previous attempt failed/was rejected.
- `broadcast` — `sendBasicTransactionWithData()` resolved with a tx hash; written to `payment_events` immediately with `confirmed_at = null`. **UI label: "Broadcasting…"** — not "confirming," not "paid." Must render for the real duration of the confirmation job (Section 5.4), never skipped or collapsed into "paid" as an optimistic update.
- `paid` — the backend confirmation job (Section 5.4) independently verifies inclusion on-chain; `payment_events.confirmed_at` is set; only now does the UI show "Paid."
- `failed` — `PermissionDeniedError` ("user rejected the confirmation dialog") or `InvalidTransactionError` ("transaction data malformed") thrown, as documented at `nimiq.dev/mini-apps/api-reference/nimiq-provider` for `sendBasicTransactionWithData()`, or the confirmation job's timeout elapses with no inclusion found; retry is offered.

This state machine is the direct implementation of brief rule 1 (Section 14): *"Fail closed: any ambiguous or missing provider response renders as pending, never as paid."* `broadcast` is deliberately not shown as "paid" — it is the ambiguous middle state the rule is written for.

### 5.4 Confirmation job (backend, authoritative for `paid`)

**Mechanism:** poll-by-hash. After a `broadcast` row is written, the backend polls Nimiq Albatross RPC `getTransactionByHash` for that `tx_hash` every **3 seconds**, up to a **60-second** timeout (20 attempts). Per the official response schema (`nimiq.com/developers/build/set-up-your-own-node/rpc-docs`, cited in `DECISIONS.md` #7), each response is `{ transaction: {...}, executionResult: boolean }`, where `transaction.blockNumber` is present once included in a block and absent while still in the mempool.

**Two conditions, not one, must both hold before `paid` is written:**
1. **Inclusion:** `transaction.blockNumber` is present.
2. **Success:** `executionResult === true`.

Timeout with neither condition met flips status to `failed` (fail-closed, not a blocking error). **Included but failed** (`blockNumber` present, `executionResult === false`) is its own case, not a timeout and not a success: Albatross records a failed transaction on-chain — the fee is charged and the transaction is permanently in a block — without applying its effect. No value moved. This maps to `failed`, immediately, the moment that response is seen, never to `paid`.

**Why poll-by-inclusion, not N-confirmation depth:** chosen over requiring N blocks past inclusion because Albatross's macro-block finality model makes deep reorg protection unnecessary at this vertical's stakes (same-day social payments, non-custodial); N-confirmation would add latency without a matching trust benefit here. This is a logged tradeoff (`DECISIONS.md`), with N-confirmation depth as a named Section 13 upgrade path if the product scope ever changes.

**Invariants (apply to every layer — API, dashboard, payer screen, tests, metrics):**
- `confirmed_at` is written **only** by this backend job. No client code or optimistic-update path may ever set it.
- `confirmed_at` is never written in the same write as `broadcast_at` — always two separate writes, even if the job runs within the same second.
- **The only valid "is this paid" check anywhere in the system is `confirmed_at IS NOT NULL`.** Checking `tx_hash` or `broadcast_at` alone is a bug: it collapses `broadcast` into `paid` and reintroduces the honor-system failure mode this product exists to remove (Section 1).
- **Metric:** every row with a non-null `confirmed_at` records `broadcast_to_confirmed_latency_ms = confirmed_at - broadcast_at` — the evidence that "Broadcasting…" was real elapsed time, not UI theater.
- **Execution-result invariant:** `paid` requires both `blockNumber` present AND `executionResult === true`. A transaction can be included and still fail (fee charged, effect not applied) — that case is `failed`, not `paid`, and not a "timeout" either, since the network answered definitively. `payment_events.execution_result` (Section 9) records which of the two failure shapes occurred — never-included-in-time vs. included-but-failed — so the audit trail can distinguish them.

**Retry invariant (Step 7):** a retry after `failed` submits a **new** `sendBasicTransactionWithData()` call, producing a **new `tx_hash`** and a **new `broadcast_at`**, written as a new `payment_events` row for the same `participant_id`. It never reuses or resubmits the old `tx_hash` — there is no such operation as "retry the old transaction," only "attempt the same frozen amount and memo again as a new transaction." This does not conflict with Section 5's ban on silent mutation: that rule freezes the *request* (total, split, participant count) once shared; it says nothing about a transaction *attempt*, which is expected to be retried as many times as needed until one is confirmed. A future implementer should not read "frozen request" as "frozen transaction" — the two are different objects in the data model (`requests`/`participants` vs. `payment_events`).

### 5.5 Ban on silent mutation

Once a request is generated and shared, its total and per-person split are frozen. Correcting an error means generating a new request, never editing the amount inside a link that's already been shared. This directly fixes the "lump-sum ambush" and "wrong amount" failure modes named in the source research.

---

## 6. End-to-end user experience

### A: Clean success

Requester enters a total and participant count (80 NIM / 4 people), taps generate, gets one link. Shares it. A participant opens it inside Nimiq Pay, sees "20 NIM to [Requester] for Dinner," taps pay. The native confirm dialog shows the amount and memo. They approve. Their screen immediately shows **"Broadcasting…"** — a real, visible pause, not a spinner masking an instant optimistic update — then flips to **"Paid"** a few seconds later once the confirmation job (Section 5.4) verifies inclusion on-chain. The requester's dashboard flips to paid at the same moment, without a manual refresh.

- **Blocked:** the link resolves only inside Nimiq Pay; opened elsewhere it shows a plain explainer instead of a broken wallet call.
- **Dashboard shows:** 1 of 4 paid, running total collected.

### B: Recoverable failure + targeted repair

A participant's approval throws `PermissionDeniedError` (rejected/cancelled) or `InvalidTransactionError` (e.g., insufficient balance).

- **Blocked:** no "paid" status is ever shown off a failed or unconfirmed attempt.
- **Allowed:** the participant can retry the exact same request without the requester regenerating anything.
- **Targeted repair:** retry re-fires the same payment intent (same amount, same memo, in Luna); it never recomputes the split.

### C: Requester replay / compare

The requester reopens a past request and sees the full per-participant history: who paid, when, and how much. They can compare it against a different request (this month's utility split vs. last month's) to catch a pattern the research names directly — costs quietly growing when nobody checks per-cycle.

- **Dashboard shows:** two requests side by side, paid/unpaid counts and totals for each.

### D: Proof of a wallet-confirmed settlement

The dashboard never marks anyone paid except off an independently chain-verified transaction tied to a stored `payment_events` row.

- **What this proves:** "paid" is a network-confirmed fact, not a self-reported checkbox or an optimistically-rendered broadcast — the exact gap Splitwise-style tracking tools leave open, and a stricter bar than the brief's original single-event assumption (Section 0).
- **Dashboard shows:** a paid entry with its confirmation event (tx hash, `broadcast_at`, `confirmed_at`, and the resulting broadcast-to-confirmed latency), not just a static label.

---

## 7. Build steps

Enterprise-scale concerns (safe promotion/rollback, automatic regression case creation, fleet observability) are out of scope for a 24-hour build and are not force-fit; where a template item doesn't apply at this scale, it is deferred to `DECISIONS.md` / Section 13 instead of faked.

### Step 1 — Lock the product contract

- **Building:** the one-paragraph contract (Section 3 thesis + Section 1's 8 jobs) as `CONTRACT.md`.
- **Why:** prevents scope creep from killing the 24-hour window.
- **User can then:** nothing yet — this is a team-alignment artifact.
- **Backend/frontend changes:** none.
- **Data/API/UI changes:** none.
- **Tested by:** every teammate can repeat the contract from memory.
- **Definition of Done:** contract fits in one paragraph; nothing outside the 8 jobs is scheduled into later steps.

### Step 2 — Scaffold the Mini App

- **Building:** a Vite app (React, per `DECISIONS.md`) with `@nimiq/mini-app-sdk` installed and `init({ timeout: 10_000 })` called on load.
- **Why:** get a loadable app inside Nimiq Pay as fast as possible; everything else builds on this shell.
- **User can then:** open a blank page inside Nimiq Pay without an error.
- **Backend/frontend changes:** frontend scaffold only; no backend yet.
- **Data/API/UI changes:** none yet; confirms `nimiq.listAccounts()` and `nimiq.isConsensusEstablished()` both resolve.
- **Tested by:** manual load on a real device inside Nimiq Pay (per `nimiq.dev/mini-apps/development/load-local-mini-app`).
- **Definition of Done:** `init()` resolves; both read-only provider calls resolve inside Nimiq Pay; public GitHub repo exists under MIT license.

### Step 3 — Split calculator + request creation screen

- **Building:** `SplitCalculator` (pure function, Luna-denominated) and one screen: total, participant count, memo, generate button.
- **Why:** turns a total and participant count into per-person amounts before any money moves.
- **User can then:** see 80 NIM / 4 people render as 20.00 NIM per person before generating anything.
- **Backend/frontend changes:** frontend only (pure client-side calculation, no persistence yet).
- **Data/API/UI changes:** `SplitCalculator` module; no schema yet.
- **Tested by:** even split, uneven split, single participant, zero and negative input rejected; remainder-cent allocation is deterministic and never silently dropped (business-outcome assertion, not just "returns a number").
- **Definition of Done:** every test in the matrix above passes; rounding rule is documented in `DECISIONS.md`.

### Step 4 — Request state + shareable link

- **Building:** request-id generation; writes total/split/memo/participant slots to the shared backend (`requests` + `participants` tables, Section 9); `RequestLinkGenerator`.
- **Why:** freezes a request the instant it's generated (Section 5.5's ban on silent mutation); required because requester and payer are on different devices.
- **User can then:** get a single URL that opens the request read-only, identically on any device.
- **Backend/frontend changes:** first backend write path; frontend reads from the backend instead of local state.
- **Data/API/UI changes:** `requests` and `participants` tables created (Section 9); a read API for a request by id.
- **Tested by:** opening the same link twice always shows the same frozen amount; a link opened on a second device shows identical data; no local-only state exists that the second device can't see.
- **Definition of Done:** cross-device consistency test passes; backend provider choice locked in `DECISIONS.md`.

### Step 5 — Wallet-mediated payment action

- **Building:** on the payer's screen, call `nimiq.sendBasicTransactionWithData({ recipient, value, data, fee?, validityStartHeight? })` with the frozen amount (converted to Luna) and memo.
- **Why:** triggers the actual native Nimiq Pay approval dialog — this IS the sponsor integration, not a button bolted onto a generic web app.
- **User can then:** tap pay and see Nimiq Pay's native confirmation dialog showing the exact frozen amount and memo.
- **Backend/frontend changes:** frontend calls the provider directly; on promise resolution (tx hash) the frontend immediately writes a `broadcast` `payment_events` row via the backend.
- **Data/API/UI changes:** `payment_events` table (Section 9); write API for a broadcast event.
- **Tested by:** approve path (tx hash returned, `broadcast` row written), reject path (`PermissionDeniedError` → `failed`, no write), invalid-transaction path (`InvalidTransactionError` → `failed`, no write). Dialog always matches the frozen request, never a client-side guess.
- **Definition of Done:** all three SDK-level paths produce the correct state transition per Section 5.3; no path ever writes `paid` directly from this step.

### Step 6 — Status read-back (confirmation, not just broadcast)

- **Building:** a backend job/endpoint that takes a `broadcast` tx hash and polls Nimiq Albatross RPC `getTransactionByHash` every 3s up to a 60s timeout (Section 5.4), then flips the participant to `paid` and sets `confirmed_at` on first confirmed inclusion, or to `failed` on timeout.
- **Why:** the evidence layer — turns a provider *approval* into a network-*confirmed* fact, closing the gap identified in Section 0 (the SDK promise resolving is not the same as on-chain confirmation).
- **User can then:** see their own screen show "Broadcasting…" immediately after approval, then flip to "Paid" once the backend confirms; the requester's dashboard reflects the same confirmed state on a different device.
- **Backend/frontend changes:** new backend polling/lookup logic; frontend subscribes to or polls the participant's status for the UI transition.
- **Data/API/UI changes:** `payment_events.confirmed_at`; a status-read API the dashboard and payer screen both consume.
- **Tested by:** kill the app mid-confirmation, reopen, confirm the state shown is the true network outcome, not a stale `broadcast` guess; status only ever changes on a confirmed lookup, never a client guess.
- **Definition of Done:** false-paid rate is zero in test; every paid-status check in code and tests reads `confirmed_at IS NOT NULL`, never `tx_hash` or `broadcast_at` alone; broadcast-to-confirmed latency is recorded per event. Mechanism locked: poll-by-hash, 3s interval, 60s timeout — engineering defaults, not sourced from Nimiq finality docs (`DECISIONS.md`).

### Step 7 — Failure handling and retry (targeted repair)

- **Building:** catch `PermissionDeniedError` / `InvalidTransactionError` and a confirmation-timeout case; show a retry button that re-fires the identical frozen request.
- **Why:** Experience B (Section 6) — recoverable failure without corrupting other participants' state (job 7).
- **User can then:** see a clear, non-alarming "payment not completed, try again" state and retry without the requester doing anything.
- **Backend/frontend changes:** retry re-uses the existing `participant_id` and frozen `share_amount`; no new request, no recomputation.
- **Data/API/UI changes:** none beyond Step 5/6's schema; retry writes a new `payment_events` row for the same `participant_id`.
- **Tested by:** cancel → retry → approve, confirm final state is `paid` exactly once, other participants' state untouched by one participant's failure.
- **Definition of Done:** retry never changes amount or memo; a failed participant never blocks or corrupts the other 3.

### Step 8 — Requester dashboard (replay/compare)

- **Building:** list view of all requests the requester has created, each with paid/unpaid counts; detail view with full participant list and timestamps.
- **Why:** Experience C — lets the requester catch delayed-settlement patterns across requests.
- **User can then:** tap into a past request and see its full participant list; view two requests side by side.
- **Backend/frontend changes:** read API for "all requests by requester_wallet"; frontend list + detail screens.
- **Data/API/UI changes:** query against `requests` filtered by `requester_wallet`; no schema change.
- **Tested by:** dashboard reflects a request created five minutes ago and one created yesterday identically; two requests render side by side correctly.
- **Definition of Done:** sort order locked in `DECISIONS.md` (newest first); side-by-side compare view works with real data from Steps 4–7.

### Step 9 — Design pass

- **Building:** strip all wallet jargon ("gas," "consensus," "address") from payer-facing screens; one action per screen.
- **Why:** judging category "design"; fixes the onboarding-friction pattern from the sourced wallet-UX research.
- **User can then:** a first-time payer with zero crypto knowledge completes a payment without instruction.
- **Backend/frontend changes:** frontend only.
- **Data/API/UI changes:** UI copy and layout only; no data model impact.
- **Tested by:** a non-technical tester outside the build team completes the flow unprompted.
- **Definition of Done:** usability pass completed and issues fixed before Step 10.

### Step 10 — Ship and open-source

- **Building:** deployment; verification that both deeplink formats (`nimiqpay://miniapp?url=...` and `https://nimpay.app/miniapps/open/...`) open the app correctly.
- **Why:** satisfies the competition's public-repo, MIT-license, functional-and-live requirements.
- **User can then:** a stranger taps a shared link and uses the app on the first attempt.
- **Backend/frontend changes:** production deploy of both frontend and backend/store.
- **Data/API/UI changes:** none; this is an operational step.
- **Tested by:** cold-start test on a device that has never opened this Mini App before.
- **Definition of Done:** both deeplink formats verified live. **Note:** frontend hosting provider (where the static Vite build itself deploys — separate from Convex, which hosts the backend) is genuinely not yet decided anywhere in this project; this is a real open item, not resolved by `DECISIONS.md` #2 (that item covers only the backend/store). Pick one at Step 10 — it does not block Steps 1–9.

### Step 11 — Deterministic judge demo

- **Building:** the scripted Plane 1 scenario (Section 5.1) with pre-filled inputs, run through the identical code path as any real request.
- **Why:** a repeatable, no-surprises walkthrough for judges.
- **User can then:** watch the same demo produce the same result every rehearsal.
- **Backend/frontend changes:** none; this step is rehearsal, not new code.
- **Data/API/UI changes:** none.
- **Tested by:** full dry run on the actual presenting device, three times, identical outcomes.
- **Definition of Done:** three consecutive identical dry runs; presenting device locked in `DECISIONS.md`.

---

## 8. Architecture (summary — full detail in `ARCHITECTURE.md`)

```
Requester device                          Payer device
  (Nimiq Pay WebView)                       (Nimiq Pay WebView)
        |                                          |
        v                                          v
  [Request UI] --generate--> [Shared Backend] <--read-- [Payer UI]
        |                    (requests,                  |
        |                     participants,               |
        |                     payment_events)              |
        |                          ^                        v
        |                          |              nimiq.sendBasicTransactionWithData()
        |                          |                        |
        |                          |              native Nimiq Pay approval dialog
        |                          |                        |
        |                          |              tx hash returned --> write `broadcast` row
        |                          |                        |
        |                 [Chain confirmation poll]  <-------
        |                 (Albatross RPC lookup)
        |                          |
        |                 flips row to `paid`, sets confirmed_at
        v                          |
  [Requester Dashboard] <----------+ (reads confirmed status, cross-device)
```

No orchestrator, control plane, or reliability layer is proposed: this is a thin client against Nimiq Pay's own wallet infrastructure plus one independent chain-confirmation check, not a system that needs its own backend brain.

### Suggested implementation split

| Layer | Responsibility |
|---|---|
| Frontend | Request creation screen, payer screen, requester dashboard; framework-agnostic within the Nimiq Pay WebView |
| Nimiq integration | `@nimiq/mini-app-sdk` `init()`, `listAccounts()`, `isConsensusEstablished()`, `getBlockNumber()`, `sendBasicTransactionWithData()` |
| Confirmation service | Backend-side polling/lookup against the Nimiq Albatross network for a given tx hash — new relative to the brief, required by Section 0's findings |
| Request state | Minimal shared backend, required from the start: requester and payer are on different devices by default |
| Storage | A lightweight key-value or document store, keyed by `request_id`, written on payment confirmation and read by the requester's dashboard (provider choice in `DECISIONS.md`) |

---

## 9. Data model

### `requests`

| Field | Type | Notes |
|---|---|---|
| `request_id` | string | primary key |
| `requester_wallet` | string | Nimiq address; no account needed |
| `total_amount` | integer (Luna) | frozen once generated |
| `currency` | enum | `NIM` only in v1 (Section 0) |
| `memo` | string | e.g. "Dinner at Taco Spot" |
| `created_at` | timestamp | |
| `participant_count` | integer | frozen once generated |

### `participants`

| Field | Type | Notes |
|---|---|---|
| `participant_id` | string | primary key |
| `request_id` | string | foreign key |
| `share_amount` | integer (Luna) | frozen at request creation |
| `status` | enum | `pending`, `broadcast`, `paid`, `failed` (Section 5.3 — expanded from the brief's 3-state enum) |
| `updated_at` | timestamp | last status change |

### `payment_events`

| Field | Type | Notes |
|---|---|---|
| `event_id` | string | primary key |
| `participant_id` | string | foreign key |
| `tx_hash` | string | returned by `sendBasicTransactionWithData` on approval |
| `provider_result` | string | raw SDK result/error captured for audit |
| `broadcast_at` | timestamp | set when the SDK promise resolves |
| `confirmed_at` | timestamp \| null | set only once the backend's independent chain lookup confirms **both** inclusion and success (Section 5.4) — **never set from the SDK call alone** |
| `execution_result` | boolean \| null | set by the confirmation job from the RPC response's `executionResult` field, the first time `transaction.blockNumber` is present (i.e., set together with a definitive outcome, whether that outcome is `paid` or an included-but-failed `failed`). Remains `null` if the transaction never appeared in a block at all (timeout case) — this is what distinguishes "never included" from "included but failed" in the audit trail. |

**Invariant:** `confirmed_at` is written only by the backend confirmation job (Section 5.4) and never in the same write as `broadcast_at`; it requires both `blockNumber` present and `execution_result === true`. `broadcast_to_confirmed_latency_ms` is derived per row as `confirmed_at - broadcast_at` once both are set. Every "is this paid" check in this codebase reads `confirmed_at IS NOT NULL` — never `tx_hash` or `broadcast_at` alone, and never `blockNumber`/inclusion alone either.

No sessions, utterances, tool-call logs, replay-run tables, or audit-event tables are proposed as separate structures: `payment_events` already is the audit trail (Experience D), and there is no conversational or agentic session to log. Three tables, appropriate for a 24-hour build with no backend team.

---

## Open items — all resolved

Every item this PRD originally deferred is now locked in `DECISIONS.md` and reflected in `TASKS.md`. Kept here as a pointer, not a live list:

1. ~~Rounding rule for split remainders~~ — resolved: `DECISIONS.md` #1 (Step 3).
2. ~~Backend/store provider choice~~ — resolved: `DECISIONS.md` #2, Convex (Step 4). Does **not** cover frontend hosting — see Step 10's note above, still genuinely open and non-blocking.
3. ~~Polling interval/mechanism for the confirmation service~~ — resolved: poll-by-hash, 3s interval, 60s timeout (Section 5.4). The numbers themselves remain a logged unsourced-engineering-default (`DECISIONS.md`, Confirmation job mechanism section, open checklist item) — not a blocker, just not to be mistaken for a documented Nimiq fact.
4. ~~Fixed NIM amount for the Plane 1 demo scenario~~ — resolved: `DECISIONS.md` #3, 80 NIM / 4 participants / 20 NIM each / "Dinner at Taco Spot" (Step 11).
5. ~~Presenting device for the judge demo~~ — resolved: `DECISIONS.md` #4, confirm day-of, not a blocker (Step 11).
6. ~~Sort order for the dashboard~~ — resolved: `DECISIONS.md` #5, newest-first (Step 8).

Two items surfaced after this list was first written, also resolved: `getTransactionByHash`'s response shape (`DECISIONS.md` #7) and custom-shares-mismatch behavior (`DECISIONS.md` #8).

---

**Status:** planning complete. All eight project files (`PRD.md`, `ARCHITECTURE.md`, `SECURITY.md`, `TESTING.md`, `DEMO.md`, `DECISIONS.md`, `.env.example`, `TASKS.md`) exist in full and are cross-checked against each other. The only genuinely open, non-blocking item left anywhere in the project is frontend hosting provider selection, deferred to Step 10 by design (see that step's Definition of Done above).
