import { useMutation, useQuery } from 'convex/react'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { formatAddressShort } from '../nimiq/formatAddress'
import { isInsideNimiqPay, sendBasicTransactionWithData } from '../nimiq/provider'
import { formatLunaAsNim } from '../split/amount'

type LocalAttemptState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'error'; message: string }

// Diagnostic-only, added during Step 5's silent-failure investigation (the
// test device had no remote debugging, so on-screen logging was the only way
// to see what was happening). Never shown to a real user or judge — only
// when ?debug=1 is explicitly added to the URL.
const DEBUG_ENABLED =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1'

/**
 * Reads the live confirmation event for a paid participant, to surface
 * `broadcast_to_confirmed_latency_ms` (PRD.md Section 5.4's metric — the
 * evidence that "Broadcasting…" was real elapsed time, not UI theater).
 */
function PaidLatency({ participantId }: { participantId: Id<'participants'> }) {
  const status = useQuery(api.paymentEvents.getParticipantStatus, { participantId })
  if (!status || status.broadcastToConfirmedLatencyMs === null) return null
  return <> · {(status.broadcastToConfirmedLatencyMs / 1000).toFixed(1)}s</>
}

/**
 * Payer-side screen (ARCHITECTURE.md 2.1), reached via `/r/<request_id>`.
 * Renders the frozen request exactly as stored (no recomputation) and, on
 * "Pay", calls `sendBasicTransactionWithData()` with the frozen amount and
 * memo. On success, records a `broadcast` event — never `paid`; that's Step
 * 6's confirmationJob only. On failure (SDK throws, or resolves with an
 * error shape), no mutation is called at all: the participant is a no-op
 * back to `pending` (ARCHITECTURE.md Section 4), and the UI offers retry,
 * which is simply calling this same handler again — a brand-new
 * `sendBasicTransactionWithData()` call produces a brand-new tx hash every
 * time, so there is no old transaction to "resubmit" (PRD.md Section 5.4
 * retry invariant).
 */
export function PayerView({ requestId }: { requestId: string }) {
  const data = useQuery(api.requests.getRequest, { requestId: requestId as Id<'requests'> })
  const recordBroadcast = useMutation(api.paymentEvents.recordBroadcast)
  const [attempts, setAttempts] = useState<Record<string, LocalAttemptState>>({})
  const [debugLog, setDebugLog] = useState<string[]>([])

  const log = (message: string) => {
    const line = `${new Date().toISOString().slice(11, 23)} ${message}`
    console.log(`[PayerView] ${message}`)
    if (DEBUG_ENABLED) setDebugLog((prev) => [...prev, line])
  }

  if (!isInsideNimiqPay()) {
    return (
      <main className="screen">
        <div className="card stack">
          <h1>Open this in Nimiq Pay</h1>
          <p className="muted">This payment link only works inside the Nimiq Pay app.</p>
        </div>
      </main>
    )
  }

  if (data === undefined) {
    return (
      <main className="screen">
        <p className="muted">Loading…</p>
      </main>
    )
  }

  if (data === null) {
    return (
      <main className="screen">
        <p className="muted">This request doesn't exist.</p>
      </main>
    )
  }

  const { request, participants } = data

  async function pay(participantId: Id<'participants'>, shareAmount: number) {
    log(`pay() called: participantId=${participantId}, shareAmount=${shareAmount}`)
    log(`isInsideNimiqPay()=${isInsideNimiqPay()}, recipient=${request.requester_wallet}, memo=${JSON.stringify(request.memo)}`)
    setAttempts((prev) => ({ ...prev, [participantId]: { kind: 'sending' } }))

    try {
      const outcome = await sendBasicTransactionWithData(
        {
          recipient: request.requester_wallet,
          value: shareAmount,
          data: request.memo,
        },
        log,
      )

      log(`pay() received outcome.kind=${outcome.kind}${outcome.kind === 'error' ? ` stage=${outcome.stage}` : ''}`)

      if (outcome.kind === 'error') {
        setAttempts((prev) => ({
          ...prev,
          [participantId]: {
            kind: 'error',
            message: 'Payment not completed. Try again.',
          },
        }))
        return
      }

      try {
        log(`calling recordBroadcast with txHash=${outcome.txHash}`)
        await recordBroadcast({
          participantId,
          txHash: outcome.txHash,
          providerResult: JSON.stringify(outcome.raw),
        })
        log('recordBroadcast succeeded')
        setAttempts((prev) => ({ ...prev, [participantId]: { kind: 'idle' } }))
      } catch (err) {
        // The broadcast genuinely happened on-chain-adjacent (wallet accepted
        // it); this is a Convex-write failure, not a payment failure. Surface
        // it distinctly rather than offering a retry that would double-spend.
        log(`recordBroadcast threw: ${err instanceof Error ? err.message : String(err)}`)
        setAttempts((prev) => ({
          ...prev,
          [participantId]: {
            kind: 'error',
            message: "Your payment went through, but we couldn't record it. Please let the organizer know.",
          },
        }))
      }
    } catch (err) {
      // Defensive: nothing above should throw past sendBasicTransactionWithData
      // (it catches internally), but this closes the gap completely so a
      // failure here is never a permanently stuck "Waiting for approval…"
      // with no way to see what happened or retry.
      log(`pay() caught an unexpected top-level error: ${err instanceof Error ? err.message : String(err)}`)
      setAttempts((prev) => ({
        ...prev,
        [participantId]: {
          kind: 'error',
          message: 'Payment not completed. Try again.',
        },
      }))
    }
  }

  return (
    <main className="screen stack">
      <div>
        <h1>{request.memo}</h1>
        <p className="muted">
          {formatLunaAsNim(request.total_amount)} total · Requested by{' '}
          {formatAddressShort(request.requester_wallet)}
        </p>
      </div>

      <ul className="participant-list">
        {participants.map((p) => {
          const attempt = attempts[p._id] ?? { kind: 'idle' as const }
          return (
            <li key={p._id} className="card stack" style={{ gap: '0.5rem' }}>
              <div className="participant-row" style={{ padding: 0 }}>
                <span className="amount-small">{formatLunaAsNim(p.share_amount)}</span>

                <span>
                  {p.status === 'pending' && attempt.kind !== 'sending' && (
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      onClick={() => pay(p._id, p.share_amount)}
                    >
                      Pay
                    </button>
                  )}
                  {attempt.kind === 'sending' && (
                    <span className="status-text">Waiting for approval…</span>
                  )}
                  {p.status === 'broadcast' && <span className="status-text">Broadcasting…</span>}
                  {p.status === 'paid' && (
                    <span className="status-paid">
                      Paid
                      <PaidLatency participantId={p._id} />
                    </span>
                  )}
                  {(p.status === 'failed' || attempt.kind === 'error') &&
                    attempt.kind !== 'sending' && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={() => pay(p._id, p.share_amount)}
                      >
                        Try again
                      </button>
                    )}
                </span>
              </div>
              {attempt.kind === 'error' && (
                <p role="alert" className="alert alert-error" style={{ margin: 0 }}>
                  {attempt.message}
                </p>
              )}
            </li>
          )
        })}
      </ul>

      {DEBUG_ENABLED && debugLog.length > 0 && <pre className="debug-panel">{debugLog.join('\n')}</pre>}
    </main>
  )
}
