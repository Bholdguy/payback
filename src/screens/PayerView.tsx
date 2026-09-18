import { useMutation, useQuery } from 'convex/react'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { isInsideNimiqPay, sendBasicTransactionWithData } from '../nimiq/provider'
import { formatLunaAsNim } from '../split/amount'

type LocalAttemptState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'error'; message: string }

/**
 * Reads the live confirmation event for a paid participant, to surface
 * `broadcast_to_confirmed_latency_ms` (PRD.md Section 5.4's metric — the
 * evidence that "Broadcasting…" was real elapsed time, not UI theater).
 */
function PaidLatency({ participantId }: { participantId: Id<'participants'> }) {
  const status = useQuery(api.paymentEvents.getParticipantStatus, { participantId })
  if (!status || status.broadcastToConfirmedLatencyMs === null) return null
  return <> (confirmed in {(status.broadcastToConfirmedLatencyMs / 1000).toFixed(1)}s)</>
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
    setDebugLog((prev) => [...prev, line])
  }

  if (!isInsideNimiqPay()) {
    return (
      <main style={{ fontFamily: 'system-ui', padding: '1.5rem' }}>
        <h1>Open this in Nimiq Pay</h1>
        <p>This payment request only works inside the Nimiq Pay app.</p>
      </main>
    )
  }

  if (data === undefined) {
    return <p>Loading…</p>
  }

  if (data === null) {
    return <p>This request doesn't exist.</p>
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
            message: `Payment was sent, but we couldn't record it: ${
              err instanceof Error ? err.message : String(err)
            }`,
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
    <main style={{ fontFamily: 'system-ui', padding: '1.5rem' }}>
      <h1>{formatLunaAsNim(request.total_amount)} requested</h1>
      <p>
        <strong>Memo:</strong> {request.memo}
      </p>
      <p>
        <strong>From:</strong> {request.requester_wallet}
      </p>
      <ul>
        {participants.map((p) => {
          const attempt = attempts[p._id] ?? { kind: 'idle' as const }
          return (
            <li key={p._id} style={{ marginBottom: '0.75rem' }}>
              {formatLunaAsNim(p.share_amount)} —{' '}
              {p.status === 'pending' && attempt.kind !== 'sending' && (
                <button type="button" onClick={() => pay(p._id, p.share_amount)}>
                  Pay
                </button>
              )}
              {attempt.kind === 'sending' && 'Waiting for approval…'}
              {p.status === 'broadcast' && 'Broadcasting…'}
              {p.status === 'paid' && (
                <>
                  Paid
                  <PaidLatency participantId={p._id} />
                </>
              )}
              {p.status === 'failed' && attempt.kind === 'idle' && (
                <>
                  Payment not completed.{' '}
                  <button type="button" onClick={() => pay(p._id, p.share_amount)}>
                    Retry
                  </button>
                </>
              )}
              {attempt.kind === 'error' && (
                <span role="alert" style={{ display: 'block', color: 'crimson' }}>
                  {attempt.message}{' '}
                  <button type="button" onClick={() => pay(p._id, p.share_amount)}>
                    Retry
                  </button>
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {/* Temporary diagnostic panel for the Step 5 silent-failure investigation
          (no remote debugging available on the test device — this is the only
          way to see what's happening step by step). Not part of the product
          UI; safe to remove once the payment trigger issue is confirmed fixed. */}
      {debugLog.length > 0 && (
        <pre
          style={{
            marginTop: '2rem',
            padding: '0.75rem',
            background: '#f4f3ec',
            fontSize: '0.75rem',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {debugLog.join('\n')}
        </pre>
      )}
    </main>
  )
}
