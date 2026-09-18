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
    setAttempts((prev) => ({ ...prev, [participantId]: { kind: 'sending' } }))

    const outcome = await sendBasicTransactionWithData({
      recipient: request.requester_wallet,
      value: shareAmount,
      data: request.memo,
    })

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
      await recordBroadcast({
        participantId,
        txHash: outcome.txHash,
        providerResult: JSON.stringify(outcome.raw),
      })
      setAttempts((prev) => ({ ...prev, [participantId]: { kind: 'idle' } }))
    } catch (err) {
      // The broadcast genuinely happened on-chain-adjacent (wallet accepted
      // it); this is a Convex-write failure, not a payment failure. Surface
      // it distinctly rather than offering a retry that would double-spend.
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
              {p.status === 'paid' && 'Paid'}
              {p.status === 'failed' && 'Failed'}
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
    </main>
  )
}
