# Architecture — Payback

Expands `PRD.md` Section 8. Self-contained: read this without needing the rest of the conversation that produced it.

---

## 1. System shape

Payback is a thin client against two authorities it does not own:

- **The Nimiq wallet (inside Nimiq Pay)** — owns private keys, transaction signing, and user approval. Payback never touches this.
- **The Nimiq Albatross network** — owns settlement truth: whether a transaction is actually included on-chain. Payback never assumes this; it checks it.

Everything Payback itself owns sits between those two: computing splits, freezing requests, and recording — never inferring — what those two authorities report back.

```
┌───────────────────────────┐        ┌───────────────────────────┐
│   Requester device         │        │   Payer device              │
│   (Nimiq Pay WebView)      │        │   (Nimiq Pay WebView)        │
│                             │        │                               │
│  CreateRequest screen       │        │  PayerView screen             │
│  RequesterDashboard screen  │        │                               │
└──────────────┬──────────────┘        └───────────────┬───────────────┘
               │  generate / read                        │  read / pay
               v                                          v
        ┌──────────────────────────────────────────────────────┐
        │                     Convex backend                     │
        │  tables: requests, participants, payment_events         │
        │  mutations: createRequest, recordBroadcast              │
        │  queries: getRequest, listRequestsByWallet,              │
        │           getParticipantStatus                           │
        │  action:  confirmationJob (scheduled, Section 4 below)   │
        └───────────────────────┬──────────────────────────────┘
                                  │ polls by tx_hash
                                  v
                     ┌─────────────────────────┐
                     │ Nimiq Albatross network   │
                     │ (via NIMIQ_RPC_URL)        │
                     └─────────────────────────┘

Payer device also talks directly to:
        ┌─────────────────────────┐
        │ Nimiq provider            │
        │ (@nimiq/mini-app-sdk,      │
        │  injected by Nimiq Pay)    │
        │ sendBasicTransactionWithData()
        └─────────────────────────┘
```

There is no orchestrator, control plane, or reliability layer. Convex is the only backend, and it does exactly three jobs: hold frozen request state, record what the Nimiq provider reported, and independently verify that report against the network before calling anything "paid."

---

## 2. Components

### 2.1 Frontend — three screens, one shared shell

All three screens are built in the same Vite + React app (`src/screens/`). They differ only in what they're allowed to write.

**`CreateRequest.tsx`** (requester, request-creation moment only)
- Owns: collecting total (NIM), participant count, memo; running `SplitCalculator` locally to preview per-person amounts *before* anything is generated.
- Does not own: persistence. Nothing is written to Convex until "generate" is tapped — at which point this screen calls the `createRequest` mutation once, and from that point on the request is Convex's, not this screen's.
- After generate: hands off to a read-only confirmation view showing the frozen amount and the shareable link (`RequestLinkGenerator`).

**`PayerView.tsx`** (payer, runs inside Nimiq Pay only)
- Owns: reading a frozen request by `request_id` from Convex (`getRequest` query) and rendering it — total, per-person share, memo, requester identity — exactly as stored, with **zero local recomputation**. This is the direct implementation of PRD Section 14 rule 3 ("No client-side truth").
- Owns: invoking the Nimiq provider's `sendBasicTransactionWithData()` with the frozen `share_amount` (Luna) and `memo`, and, on promise resolution, calling the `recordBroadcast` mutation with the returned `tx_hash`.
- Does not own: deciding when a payment is "paid." This screen can only ever write a `broadcast` event. It has no code path that writes `confirmed_at`.
- Owns: rendering the three visible states — `pending` ("Pay"), `broadcast` ("Broadcasting…"), `paid` ("Paid") — by subscribing to `getParticipantStatus` for its own `participant_id` and re-rendering on change; it does not locally flip state based on the SDK promise resolving.
- Blocked, by design: if opened outside Nimiq Pay (no injected provider), this screen renders a plain explainer instead of attempting `init()` and failing — never a broken wallet call.

**`RequesterDashboard.tsx`** (requester, any device, any time after creation)
- Owns: listing all requests where `requester_wallet` matches the connected wallet (`listRequestsByWallet`, sorted newest-first per `DECISIONS.md` #5), and rendering per-participant status, timestamps, and the settlement timeline (PRD Section 11) for a selected request.
- Owns: the side-by-side compare view (two requests rendered from two independent `getRequest` reads).
- Does not own: writing anything. This screen is read-only against Convex; it has no mutation calls at all.

### 2.2 Nimiq SDK integration layer (`src/nimiq/provider.ts`)

A single module wrapping `@nimiq/mini-app-sdk`, called from `PayerView` and, for the read-only status checks, from `CreateRequest`:

- `init({ timeout: 10_000 })` — called once on app load; every other call awaits this.
- `listAccounts()` — used only to get the requester's own address when creating a request (`requester_wallet`); never used to impersonate or select a payer's account on their behalf.
- `isConsensusEstablished()` / `getBlockNumber()` — used to gate the "Pay" button (don't offer payment if the wallet's own client hasn't reached consensus) and are display-only; **never used as a substitute for the backend's confirmation check.** This module has no method that writes to Convex — it only returns raw provider results, which the calling screen then hands to a mutation.
- `sendBasicTransactionWithData({ recipient, value, data, fee?, validityStartHeight? })` — the single call that triggers the native approval dialog. `recipient` is the requester's wallet address (from `requests.requester_wallet`), `value` is `participants.share_amount` in Luna, `data` is `requests.memo`.

This layer owns translating between the app's domain types (Luna integers, frozen request/participant records) and the SDK's call shape. It owns nothing about state transitions — that's Convex's job (Section 3).

### 2.3 Convex backend

**Tables:** `requests`, `participants`, `payment_events` — exactly the three from PRD Section 9, no additions.

**Mutations (client-callable, narrow surface):**
- `createRequest(total, participant_count | custom_shares, memo, requester_wallet)` → runs `SplitCalculator` server-side (not trusting a client-computed split), writes one `requests` row and N `participants` rows, all in one transaction. This is the only place `requests`/`participants` are ever written after creation — there is no `updateRequest` mutation. Freezing (PRD Section 5.5) is enforced by *absence of a write path*, not by a client-side convention.
- `recordBroadcast(participant_id, tx_hash)` → writes one `payment_events` row with `broadcast_at = now()`, `confirmed_at = null`, flips `participants.status` to `broadcast`. Callable by the payer's own client only for its own `participant_id` — this scoping rule is enforced here, in the mutation itself; `SECURITY.md` Section 5 covers the separate question of what happens if that enforcement is bypassed via a compromised Convex deployment.

**Queries (read-only):**
- `getRequest(request_id)`, `listRequestsByWallet(wallet)`, `getParticipantStatus(participant_id)`.

**Action (not client-callable, runs server-side only):**
- `confirmationJob(participant_id, tx_hash)` — scheduled immediately after `recordBroadcast` succeeds (Convex scheduled function, delay 0). Calls `getTransactionByHash(tx_hash)` against `NIMIQ_RPC_URL` every 3 seconds, up to 60 seconds (PRD Section 5.4 / `DECISIONS.md` #6 for the endpoint requirement). **Field-level check, two conditions** (`DECISIONS.md` #7, official schema): the response is `{ transaction: {...}, executionResult: boolean }`.
  - `transaction.blockNumber` absent → not yet included, keep polling.
  - `transaction.blockNumber` present **and** `executionResult === true` → write `confirmed_at = now()` and `execution_result = true` to the existing `payment_events` row (a second write, never the same write as `broadcast_at`), flip `participants.status` to `paid`.
  - `transaction.blockNumber` present **and** `executionResult === false` → **included but failed**: the transaction landed on-chain (fee charged) but its effect never applied, so no value moved. Write `execution_result = false` (leave `confirmed_at` null) and flip `participants.status` to `failed` immediately — this is a definitive network answer, not a timeout, and it is resolved the moment it's seen rather than waiting out the remaining poll window.
  - Timeout with `blockNumber` never observed → flip `participants.status` to `failed`, `execution_result` stays `null` (distinguishing "never included" from "included but failed" in the audit trail, PRD Section 9).

  **This action is the only code path in the entire system that can set `confirmed_at` or `execution_result`.** No mutation exposed to any client can do this.

### 2.4 Confirmation job — treated as its own component, not a detail of Convex

Because PRD Section 5.4's invariants depend entirely on this job being the sole writer of `confirmed_at`, it's called out separately here even though it physically lives inside Convex:

- **Input:** a `(participant_id, tx_hash)` pair, handed to it once by `recordBroadcast` — it never discovers work on its own by scanning for `broadcast` rows, which would blur the line between "recorded a broadcast" and "started confirming it."
- **Output:** exactly one terminal write — `paid` or `failed` — per invocation. It does not retry itself; retries are a user-initiated new `recordBroadcast` call (Section 3 below), not this job looping.
- **Failure mode:** if Convex itself restarts mid-poll, the scheduled action re-runs from Convex's own retry semantics; because the job is idempotent per `tx_hash` (checking `getTransactionByHash` doesn't change based on how many times you ask), a restart cannot produce a duplicate `paid` write with different values — worst case it polls a few extra times.

---

## 3. Full request path (generate → paid), cross-device

1. Requester fills in total/participants/memo on `CreateRequest`; `SplitCalculator` previews the split client-side (no write yet).
2. Requester taps generate → `createRequest` mutation → Convex re-runs `SplitCalculator` server-side, writes `requests` + `participants`, returns `request_id`.
3. `RequestLinkGenerator` builds the shareable URL from `request_id` and `VITE_APP_URL` (both deeplink forms — `.env.example`).
4. Requester shares the link. **Different device from here on.**
5. Payer opens the link inside Nimiq Pay → `PayerView` calls `getRequest(request_id)` → renders the frozen amount/memo verbatim.
6. Payer taps pay → `provider.ts` calls `sendBasicTransactionWithData()` → native Nimiq Pay dialog → user approves or the SDK throws.
   - Approve path: promise resolves with `tx_hash` → `PayerView` calls `recordBroadcast(participant_id, tx_hash)` → Convex writes the `broadcast` event and schedules `confirmationJob`. **Different device from here on, again — the requester's dashboard needs to see this.**
   - Reject/error path: `PermissionDeniedError` or `InvalidTransactionError` caught client-side, no mutation called, UI shows retry (Section 4 of PRD, Step 7).
7. `confirmationJob` polls `NIMIQ_RPC_URL` for `tx_hash`. On inclusion: writes `confirmed_at`, flips status to `paid`. On timeout: flips status to `failed`.
8. `PayerView` (still subscribed to `getParticipantStatus`) and `RequesterDashboard` (polling or subscribed to the same request) both observe the status flip **from the same Convex write** — this is what makes the update appear on the requester's device "without a manual refresh": there is one source of truth being read twice, not two devices independently guessing.

---

## 4. State machine, mapped to the component that owns each transition

```
pending  ──(payer taps pay, SDK approves)──>  broadcast  ──(confirmationJob confirms)──>  paid
   │                                              │
   └──(SDK throws, or confirmationJob times out)──┴──> failed ──(user retries)──> pending (new payment_events row on next broadcast)
```

| Transition | Who performs the write | Where |
|---|---|---|
| — → `pending` | `createRequest` mutation | Convex, at request creation |
| `pending` → `broadcast` | `recordBroadcast` mutation | Convex, triggered by `PayerView` after SDK resolves |
| `broadcast` → `paid` | `confirmationJob` action | Convex, server-side only, never client-callable |
| `pending`/`broadcast` → `failed` | `recordBroadcast`'s absence (SDK threw, nothing written) is a no-op back to `pending`; `confirmationJob`'s timeout write is the only actual `failed` write | Convex |
| `failed` → `pending`/new `broadcast` | user-initiated retry → a fresh `sendBasicTransactionWithData()` call → fresh `recordBroadcast` with a **new `tx_hash`**, never reusing the old one (PRD Section 5.4 retry invariant) | Client + Convex |

No component other than `confirmationJob` ever writes `confirmed_at`. No component other than the payer's own `PayerView` ever writes `broadcast_at`. `requests`/`participants` core fields (`total_amount`, `share_amount`, `participant_count`) are written exactly once, at `createRequest`, and never again — there is no code path in this architecture that could mutate them, which is what makes the frozen-request invariant (PRD Section 5.5) a structural property of the system rather than a convention someone could forget to follow.

---

## 5. What this architecture explicitly does not include, and why

- **No separate auth/account service** — identity is the connected wallet address, read via `listAccounts()`; Convex mutations scope by wallet address, not by session/login.
- **No message queue or event bus** — one Convex deployment, one scheduled action per broadcast event; at this scale a queue would be solving a problem that doesn't exist yet.
- **No client-side polling of the Nimiq network** — only `confirmationJob` talks to `NIMIQ_RPC_URL`; this keeps "who is allowed to declare something paid" to exactly one place, which is the entire point of Section 4's ownership table.
