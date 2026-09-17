# Demo Script — Payback

The complete 17-beat judge walkthrough (`PRD.md` Section 17 / brief Section 17), adapted for the locked Plane 1 scenario (`DECISIONS.md` #3: 80 NIM, 4 participants, 20 NIM each, memo "Dinner at Taco Spot") and folding in the "Broadcasting…" beat exactly as specified in `PRD.md` Section 5.3/5.4. This is the full script — not an excerpt. Rehearse it three consecutive times with identical outcomes before presenting (`PRD.md` Step 11 Definition of Done).

---

1. Open with the problem, one sentence: "You paid for dinner. Three weeks later, one friend still hasn't sent it back."

2. Name the sourced pattern: this isn't a guess — it's the top recurring complaint pattern across r/venmo, r/AmItheAsshole, and r/roommates.

3. Open Payback inside Nimiq Pay on the presenting device (device confirmed day-of, `DECISIONS.md` #4).

4. Enter total: **80 NIM**. Participants: **4**. Memo: **"Dinner at Taco Spot."** Narrate it as "an $80 dinner" for relatability — the app itself takes 80 NIM as direct input, no currency conversion happens anywhere in this product (`PRD.md` Section 0/4).

5. Tap generate. Show the frozen request screen: **20.00 NIM per person**, computed and locked before anything is shared.

6. Copy the link, switch to a second device (or the judge's own phone).

7. Open the link inside Nimiq Pay on the second device. Show the payer screen: exact amount, exact memo, no wallet jargon visible anywhere.

8. Tap pay. The native Nimiq Pay confirmation dialog appears, showing the same frozen amount and memo — point out it's the same numbers just shown, not a re-typed or re-guessed value.

9. Approve. The payer's screen immediately shows **"Broadcasting…"** — not "Paid," not a spinner standing in for an instant optimistic update.

10. **While it's visibly sitting on "Broadcasting…," say out loud:** "This pause is the confirmation job proving this actually settled on-chain — it's not lag, and we're not going to fake past it." Let the pause run its real course; don't rush past it or cut away.

11. A few seconds later, the screen flips to **"Paid"** with a timestamp.

12. Switch back to the requester's screen. Point out: no refresh happened, no manual mark-as-paid, the status flipped on its own — because both screens just read the same confirmed fact from the same backend write, not two devices independently guessing.

13. Show the settlement timeline lighting up for that participant, with the timestamp visible underneath.

14. Trigger a second payer's rejection path deliberately: tap pay, then reject in the native dialog. Show explicitly that the app never shows false-paid — the participant stays `pending`, with a clear "payment not completed, try again" state offered.

15. Retry that same payer's request: approve this time. Show it re-fires as a brand-new transaction (new broadcast, new "Broadcasting…" pause) and recovers cleanly to "Paid" — never reusing or resubmitting the failed attempt.

16. Open the requester dashboard. Show a second, older seeded request next to this one, side by side, sorted newest-first.

17. Point at the compare view: "This is what catches the year-end lump-sum ambush from the research, before it happens." Then state the cost model and close: "Zero platform fee, funds arrive in the wallet immediately, no 75-day hold. **This isn't a tip jar. It's the end of 'I'll send it later.'**"

---

**Rehearsal note:** beats 9–11 (the broadcasting pause) are the one place in this script where silence is doing work, not a gap to fill with talking. If the confirmation job's actual latency ever drops low enough that the pause feels invisible on the presenting device, that's still correct behavior — the invariant (`PRD.md` Section 5.4) is that the state is real, not that it's dramatic. Don't add an artificial delay to make beat 10 land better; narrate what's actually happening, at whatever speed it actually happens.
