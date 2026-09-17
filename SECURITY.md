# Security — Payback

Built from `PRD.md` Section 14 (technical correctness rules) and Section 5.4 (confirmation invariants). Self-contained.

---

## 1. No private key or seed phrase handling, anywhere in this app

Payback never generates, requests, stores, transmits, or displays a private key, seed phrase, or any other key material, at any layer — frontend, Convex backend, or logs.

- Every wallet operation (`listAccounts`, `sendBasicTransactionWithData`, and any future `sign` call) goes through the Nimiq provider injected by Nimiq Pay (`@nimiq/mini-app-sdk`). The app calls a method; the wallet, running natively outside the app's WebView sandbox, is what holds and uses the key.
- The app's own identity model reflects this: a "user" is a wallet address string (`requester_wallet`, `requester's own participant record`), never a credential. There is no login, password, or session token anywhere in the system — the wallet address returned by `listAccounts()` **is** the identity, and it carries no secret.
- Convex, the app's only backend, never receives, requests, or stores anything resembling key material. Its tables (`requests`, `participants`, `payment_events`) contain amounts, memos, wallet addresses, statuses, and transaction hashes — all public-by-nature values that were going to be visible on-chain or in a shared link anyway.
- **Consequence for implementers:** if a future change ever needs the app to "know" a private key or seed phrase for any reason — signing on the user's behalf, recovering a wallet, anything — that is out of scope and a rule violation, not a feature request to fulfill. There is no legitimate reason for this codebase to touch key material; if a task description implies one, that's a signal to stop and re-read PRD Section 1's job list, not to proceed.

---

## 2. All wallet operations are provider-mediated

Every value-moving action in Payback is a call to `nimiq.sendBasicTransactionWithData()`. The app constructs the *arguments* (recipient, value in Luna, memo) from data it already has (the frozen request), but it never constructs, signs, or broadcasts a transaction itself — that entire responsibility sits inside Nimiq Pay's native code, behind a confirmation dialog the user must explicitly approve.

This has two security consequences worth stating explicitly:

- **The app cannot move funds without the user's own native-dialog approval, full stop.** There is no code path — not a bug, not a compromised Convex deployment, not a malicious dependency in the frontend bundle — that can cause a payment to leave a payer's wallet without that payer approving a native dialog showing the real amount and memo. Compromising Payback's frontend or backend can lie to a user about *what's being requested*, but it cannot itself extract or move funds.
- **Payback's job is to get the dialog's contents right, and to never lie about the outcome afterward** (Section 4). Those are the two places a compromise or bug in this codebase could actually cause harm to a user, and everything else in this document is about closing those two.

---

## 3. The frozen-request invariant, and why it exists

Once `createRequest` runs, `requests.total_amount`, `requests.participant_count`, and every `participants.share_amount` are written exactly once and never updated by any code path in this system (`ARCHITECTURE.md` Section 4). There is no `updateRequest` mutation. This isn't a UI convention that a screen chooses not to expose — it's the absence of a write path in the Convex schema itself.

**Why this is a security property, not just a product one:** without it, a compromised or buggy requester-side client (or a compromised Convex deployment, see Section 5) could silently change the amount a payer sees *after* a link has already been shared and trusted — the exact "lump-sum ambush" / bait-and-switch pattern named in the source research (PRD Section 5.5). A payer who has already glanced at a request, trusts the memo and amount, and pays without re-reading every digit is exposed to exactly this if mutation were possible. Freezing the request removes that entire class of attack: there is nothing to silently change, because nothing can be changed at all.

Correcting a genuine mistake means generating a brand-new request with a new `request_id` — never editing the shared one. A payer who already paid the old (wrong) request is not silently migrated; that's a manual reconciliation the requester handles out-of-band, which is an acceptable cost for removing the mutation attack surface entirely.

---

## 4. The `confirmed_at`-only invariant, and why "broadcast implies paid" is a security failure, not a UX nitpick

`confirmed_at` is written only by the `confirmationJob` Convex action (`ARCHITECTURE.md` Section 2.3/2.4), never by any client-callable mutation. The only valid "is this participant paid" check anywhere in the system is `confirmed_at IS NOT NULL`.

**Why treating a `broadcast` `tx_hash` as equivalent to `paid` is a trust failure, not just an imprecise UI label:**

- `sendBasicTransactionWithData()` resolving proves the user approved a transaction and the wallet broadcast it. It does **not** prove the transaction was ever included on-chain. A broadcast transaction can fail to confirm — insufficient fee, an expired `validityStartHeight`, a network partition, or any other reason a mempool entry never makes it into a block.
- If Payback showed "Paid" at the moment `tx_hash` returns, a requester's dashboard could report a participant as settled when no value had actually moved yet. The requester might reasonably act on that — stop chasing that participant, consider the group bill closed — while the underlying transaction silently fails. This is functionally identical to a forged receipt: a status the requester trusts, that doesn't correspond to an on-chain fact.
- This is exactly the failure mode Payback's entire premise (PRD Section 1) exists to eliminate: "showing 'paid' before a wallet actually confirms it turns the app into exactly the honor-system ledger... that... people already distrust." A false-paid bug doesn't just misinform a UI label — it recreates, inside a product whose only value proposition is *not being that*, the precise failure that product was built to remove. That's why PRD Section 10 (carried from the brief) names false-paid rate as the one metric that "must be zero" — every other metric can regress a little; this one is a correctness bar, not a target.
- Concretely: **any future code — a new dashboard view, a new test, a new metrics query, a new API consumer — that checks `tx_hash IS NOT NULL` or `broadcast_at IS NOT NULL` as a proxy for "paid" is reintroducing this exact security-relevant failure**, even if it never touches a private key or moves a fund incorrectly. It is a trust-integrity bug, and it is graded as a correctness bug of the same severity as one that mishandles money, per `TESTING.md`'s hard assertion rule.

---

## 5. Threat model: if the Convex backend is compromised

Convex is Payback's only backend and, under the current architecture, the sole authority for what counts as "paid" (`ARCHITECTURE.md` Section 4). This section states plainly what that does and does not expose.

### What an attacker with write access to Convex **could** do

- **Forge a `paid` status without a real confirmed transaction.** Because `confirmationJob` is the only writer of `confirmed_at` by *convention enforced through Convex's function permissions*, not through any independent on-chain proof the client re-verifies, an attacker who compromises the Convex deployment itself (not just a client) could call the equivalent of `confirmationJob`'s write directly and mark any participant `paid` with no real transaction behind it. **This is the single point of trust in the v1 architecture**, and it is an accepted risk for a 24-hour hackathon build (`DECISIONS.md`), not a gap the team was unaware of. A future hardening step (Section 13-class extension, not in v1 scope) would be having each client independently re-verify `tx_hash` inclusion against `NIMIQ_RPC_URL` rather than trusting Convex's `confirmed_at` value outright — defense in depth against exactly this.
- **Tamper with `total_amount` / `share_amount` / `participant_count`** on existing rows, if the attacker has raw database write access rather than being limited to calling exposed mutations. The *mutation surface* has no update path (Section 3), but raw backend compromise bypasses application-level rules, same as with any backend. This would break the frozen-request invariant at the infrastructure level, not the application level.
- **Read all request data**: total amounts, memos, wallet addresses, participant lists, and payment history across every request in the deployment. None of this is more sensitive than what's already visible on a shared link or on-chain, but it is a full read of the app's dataset.
- **Deny service**: delete or corrupt rows, stall the confirmation job, or otherwise make the app stop functioning correctly.

### What an attacker with write access to Convex **could not** do

- **Move funds, sign a transaction, or access any private key.** Convex never holds key material (Section 1); a compromised Convex deployment has no wallet to steal from and no signing capability to abuse. The worst outcome is *lying about payment state inside the app*, not *causing an unauthorized transfer*.
- **Cause a payment to leave a wallet the user didn't approve.** That still requires the native Nimiq Pay dialog and the user's explicit approval (Section 2), regardless of what Convex says.
- **Impersonate a specific wallet's approval.** Convex can lie about status; it cannot produce a valid signature or a real on-chain transaction on a user's behalf.

### Net assessment for a hackathon-scope build

The worst-case Convex compromise is a **trust/integrity failure** (the app can be made to lie about who paid), not a **funds-loss failure** (the app can never be made to move money it wasn't authorized to move). This is an intentional and acceptable tradeoff for a 24-hour, non-custodial social-payment demo: the blast radius of the one centralized component is bounded to "the dashboard could be wrong," never to "a wallet could be drained." Any future scope expansion that increases the amounts at stake should revisit this and consider client-side independent re-verification of `confirmed_at` claims before treating Convex's word as sufficient on its own.
