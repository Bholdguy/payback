# Testing — Payback

Expands `PRD.md` Section 16. Self-contained.

---

## Hard assertion rule (applies to every test in this document)

**No test passes on rendered "Paid" text alone, or on any client-observable signal short of stored data.** Every test that asserts a participant is paid must assert, directly against Convex (or the Convex test harness), that `payment_events.confirmed_at IS NOT NULL` for that participant's most recent event. A test that only checks that a screen shows the string "Paid" is not a valid paid-state test in this codebase, no matter how it's written — it is testing UI rendering, not the fact the UI is supposed to represent.

Corollary, stated for the same reason: **no test may assert "paid" by checking `tx_hash IS NOT NULL` or `broadcast_at IS NOT NULL` alone.** That is the exact bug `SECURITY.md` Section 4 names as a trust failure, and a test suite that accepts it as a passing condition would certify the bug as correct behavior.

---

## 1. Unit tests — `SplitCalculator`

Pure function, Luna-denominated, no I/O. Every case below is a distinct test, not a variation folded into one:

| Case | Input | Expected |
|---|---|---|
| Even split | 8,000,000 Luna (80 NIM), 4 participants | 4 × 2,000,000 Luna each |
| Uneven split, remainder to first participant | 8,000,001 Luna, 4 participants | participant[0] = 2,000,001 Luna, others = 2,000,000 Luna each — per `DECISIONS.md` #1 |
| Single participant | any total, 1 participant | that participant owes the full total |
| Zero participants | any total, 0 participants | rejected — throws/returns an error, never a divide-by-zero or an empty array |
| Zero total | 0 Luna, N participants | rejected — a request must have a positive amount |
| Negative total | negative Luna value | rejected |
| Negative participant count | negative integer | rejected |
| Custom shares summing to total | e.g. [3,000,000, 5,000,000] for an 8,000,000 total | accepted as given, no recomputation |
| Custom shares NOT summing to total | e.g. [3,000,000, 4,000,000] for an 8,000,000 total | rejected — request creation fails; the app never silently adjusts a custom share to make totals match |
| Remainder allocation is deterministic across repeated calls | same input called twice | identical output both times — no randomness, no reliance on object iteration order |
| Very large total (near Luna integer overflow boundary for the runtime's number type) | large Luna value | either handled correctly or explicitly rejected with a clear error — never silently truncated |

**Business-outcome assertion for all of the above:** tests assert the actual Luna values returned, and for the remainder case specifically assert *which* participant received the extra Luna (index 0), not merely that the sum of shares equals the total.

---

## 2. Integration tests — request lifecycle (Convex functions, no UI, no Nimiq provider)

| Test | Setup | Assertion |
|---|---|---|
| Request creation freezes state | call `createRequest` | `requests`/`participants` rows exist with the server-computed split; no mutation exists that could alter `total_amount`, `share_amount`, or `participant_count` afterward (assert by attempting to call a non-existent `updateRequest` — i.e., assert the mutation is absent from the deployed function list, not just untested) |
| Cross-device read consistency | `createRequest`, then call `getRequest` twice as if from two different clients | identical frozen values both times |
| `recordBroadcast` writes `broadcast`, never `paid` | call `recordBroadcast(participant_id, tx_hash)` | `participants.status === 'broadcast'`; `payment_events.confirmed_at === null`; `payment_events.broadcast_at` is set |
| `recordBroadcast` is scoped to its own participant | attempt to call `recordBroadcast` for a `participant_id` that isn't the caller's own | rejected — a payer cannot record a broadcast event for someone else's share |
| `confirmationJob` is the only writer of `confirmed_at` | invoke the confirmation job directly against a known tx hash in a test/mock RPC environment | `confirmed_at` is set only by this code path; grep the Convex function directory confirms no other mutation touches this field |
| Retry writes a new `payment_events` row, not a mutated old one | simulate `failed` → retry → `recordBroadcast` with a new `tx_hash` | two distinct `payment_events` rows exist for the same `participant_id`, with two distinct `tx_hash` values and two distinct `broadcast_at` timestamps; the old row's `confirmed_at` (if any) is untouched |
| One participant's failure doesn't affect others | 4 participants, one throws `InvalidTransactionError` | the other 3 participants' `status` and `payment_events` rows are unaffected |
| Dashboard query scoping | two different `requester_wallet` values, each with requests | `listRequestsByWallet(wallet_a)` never returns `wallet_b`'s requests |
| Sort order | 3 requests created at different times | `listRequestsByWallet` returns them newest-first, per `DECISIONS.md` #5 |

---

## 3. End-to-end tests (real device, inside Nimiq Pay, per `PRD.md` Step 11's rehearsal requirement)

Run the full Plane 1 scenario (`DECISIONS.md` #3: 80 NIM, 4 participants, 20 NIM each, memo "Dinner at Taco Spot") end to end, on two physical devices:

1. Create the request on device A. Confirm the frozen-amount screen shows 20.00 NIM per person before sharing.
2. Copy the link, open it on device B inside Nimiq Pay. Confirm it renders the identical frozen amount/memo (no recomputation).
3. Tap pay on device B. Confirm the native Nimiq Pay dialog shows the exact frozen amount and memo — assert this by screenshot/manual comparison against the frozen request, not by trusting the dialog rendered *something*.
4. Approve. Confirm device B's screen shows "Broadcasting…" for a real, non-zero duration (assert elapsed time > 0, i.e., it isn't visually skipped), then flips to "Paid."
5. Confirm device A's dashboard reflects the same "Paid" state without a manual refresh, and that the timestamp shown matches `payment_events.confirmed_at` for that participant (query Convex directly to compare, don't just eyeball it).
6. Repeat the full scenario three consecutive times with identical outcomes (`PRD.md` Step 11's Definition of Done) — this is a hard gate before the demo is considered rehearsal-ready.
7. Cold-start test: open the shared link on a device that has never opened this Mini App before; confirm the payment completes unassisted, with no instruction given to the tester.

---

## 4. Failure-injection scenarios

Every scenario below must end with the system in a state consistent with the state machine (`ARCHITECTURE.md` Section 4) — never a state that implies "paid" without a confirmed on-chain fact.

| Scenario | How to trigger | Required end state |
|---|---|---|
| User cancels the native dialog | dismiss/reject the confirmation dialog before approving | SDK throws `PermissionDeniedError`; no `recordBroadcast` call is made; participant remains `pending`; retry is offered |
| Insufficient balance | attempt payment from a wallet with insufficient NIM | SDK throws `InvalidTransactionError` (per `nimiq.dev/mini-apps/api-reference/nimiq-provider`, this is the documented error for a malformed/unpayable transaction — there is no separate documented "insufficient balance" error type, so this is the path both conditions share); no `recordBroadcast` call; participant remains `pending`; retry is offered |
| `PermissionDeniedError` explicitly | as above | same as "user cancels" — these are the same underlying SDK error |
| `InvalidTransactionError` explicitly | malformed transaction data (e.g., a test harness deliberately constructs a bad payload) | same as "insufficient balance" — same underlying SDK error, different real-world cause, identical handling |
| Confirmation timeout (never included) | mock RPC returns a response with `transaction.blockNumber` absent on every poll, let the 60-second window elapse | `confirmationJob` flips `participants.status` to `failed`; `confirmed_at` remains `null`; `execution_result` remains `null` (never included, distinct from included-but-failed); `broadcast_at` remains set (the audit trail of the attempt is preserved, not deleted); retry is offered |
| `getTransactionByHash` two-condition check — happy path | mock RPC returns `blockNumber` absent on the first 2 polls, then `{ transaction: { blockNumber: N, ... }, executionResult: true }` on the 3rd | `confirmationJob` does not confirm on either absent-`blockNumber` response; confirms only on the response with both `blockNumber` present and `executionResult === true` — assert this by inspecting which poll attempt triggered the `confirmed_at` write, not just that it eventually got set (`DECISIONS.md` #7) |
| **Included but failed** — `blockNumber` present, `executionResult` false | mock RPC returns `{ transaction: { blockNumber: N, ... }, executionResult: false }` on the first poll | `confirmationJob` flips `participants.status` to `failed` **immediately on that response**, not after the 60s timeout; `payment_events.execution_result = false`; `confirmed_at` remains `null` — assert the system never writes `paid` here even though the transaction was genuinely included in a block. Assert this case is distinguishable in the audit trail from the never-included timeout case above (one has `execution_result = false`, the other has `execution_result = null`). This is the case where a transaction landed on-chain, the fee was charged, but its effect never applied — no value moved — and it is the single scenario this two-condition check exists to catch. |
| App killed mid-broadcast (before `recordBroadcast` completes) | kill the app process between SDK resolution and the mutation call completing, then reopen | on reopen, `PayerView` reads current state from Convex, which shows `pending` (the broadcast was never recorded) — the UI must not show a stale "Broadcasting…" from local-only state that Convex never received |
| App killed mid-confirmation (after `broadcast`, before `paid`/`failed`) | kill the app after `recordBroadcast` succeeds but before the confirmation job resolves, then reopen | on reopen, the UI reads the true current status from Convex — `broadcast` if still polling, `paid` or `failed` if the job has since resolved server-side (the job runs independently of the client being open) — never a client-side guess |
| Two devices reading the same request simultaneously | device A and device B both open the same link at the same time | both render identical frozen data; if one has already paid, the other sees the correct live status, not a cached pre-payment view |
| Retry after failure, then approval | fail once (any cause above), retry, approve | exactly one `payment_events` row ends with `confirmed_at` set; the earlier failed row's `confirmed_at` remains `null` permanently — retrying never backfills or reinterprets the old row |

---

## 5. Metrics validation

- **Broadcast-to-confirmed latency:** for every `payment_events` row with a non-null `confirmed_at`, assert `broadcast_to_confirmed_latency_ms = confirmed_at - broadcast_at` computes correctly and is always non-negative (a negative value would indicate `confirmed_at` was set before `broadcast_at`, which should be impossible given the write ordering in `ARCHITECTURE.md` Section 4 — treat this as a critical test if it ever fires).
- **False-paid rate:** across the full failure-injection suite (Section 4 above), assert zero instances of `participants.status === 'paid'` where the corresponding `payment_events.confirmed_at` is null — this is the metric `PRD.md`/`SECURITY.md` name as required to be zero, not just low.
- **Split-calculation error rate:** across the unit test suite (Section 1), assert zero instances where the sum of rendered per-person shares does not equal the frozen `total_amount`.
