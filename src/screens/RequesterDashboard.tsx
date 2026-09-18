import { useQuery } from 'convex/react'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useRequesterWallet } from '../nimiq/useRequesterWallet'
import { formatLunaAsNim } from '../split/amount'

const STATUS_LABEL: Record<string, string> = {
  pending: 'Not paid yet',
  broadcast: 'Broadcasting…',
  paid: 'Paid',
  failed: 'Not completed',
}

function ParticipantRow({
  participantId,
  shareAmount,
}: {
  participantId: Id<'participants'>
  shareAmount: number
}) {
  const status = useQuery(api.paymentEvents.getParticipantStatus, { participantId })
  if (!status) return null
  const { participant, latestEvent, broadcastToConfirmedLatencyMs } = status

  return (
    <li className="participant-row" style={{ padding: '0.5rem 0' }}>
      <span>{formatLunaAsNim(shareAmount)}</span>
      <span className={participant.status === 'paid' ? 'status-paid' : 'status-text'}>
        {STATUS_LABEL[participant.status] ?? participant.status}
        {latestEvent?.confirmed_at != null && broadcastToConfirmedLatencyMs !== null && (
          <span className="muted"> · confirmed in {(broadcastToConfirmedLatencyMs / 1000).toFixed(1)}s</span>
        )}
      </span>
    </li>
  )
}

function RequestDetail({ requestId }: { requestId: Id<'requests'> }) {
  const data = useQuery(api.requests.getRequest, { requestId })

  if (data === undefined) return <p className="muted">Loading…</p>
  if (data === null) return <p className="muted">This request doesn't exist.</p>

  const { request, participants } = data

  return (
    <div className="card">
      <p className="amount-small">{formatLunaAsNim(request.total_amount)}</p>
      <p>{request.memo}</p>
      <p className="muted">Created {new Date(request._creationTime).toLocaleString()}</p>
      <ul className="participant-list" style={{ marginTop: '0.75rem' }}>
        {participants.map((p) => (
          <ParticipantRow key={p._id} participantId={p._id} shareAmount={p.share_amount} />
        ))}
      </ul>
    </div>
  )
}

/**
 * Requester-side, read-only (ARCHITECTURE.md 2.1: "zero mutation calls").
 * List view with paid/unpaid counts, newest-first (`DECISIONS.md` #5); a
 * detail view per selected request; and a side-by-side compare view when two
 * are selected (Experience C, PRD.md Section 6). Keeps the confirmation
 * timestamps/latency detail (Experience D) — that evidence is this screen's
 * explicit purpose, not incidental jargon to strip.
 */
export function RequesterDashboard() {
  const { wallet: requesterWallet, error: walletError } = useRequesterWallet()
  const requests = useQuery(
    api.requests.listRequestsByWallet,
    requesterWallet ? { requesterWallet } : 'skip',
  )
  const [selected, setSelected] = useState<Id<'requests'>[]>([])

  if (walletError) {
    return (
      <main className="screen">
        <p className="alert alert-error">{walletError}</p>
      </main>
    )
  }
  if (requesterWallet === null || requests === undefined) {
    return (
      <main className="screen">
        <p className="muted">Loading…</p>
      </main>
    )
  }

  function toggleSelect(id: Id<'requests'>) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 2) return [prev[1], id]
      return [...prev, id]
    })
  }

  return (
    <main className="screen">
      <a className="top-link" href="/">
        New request
      </a>
      <h1>Your requests</h1>

      {requests.length === 0 ? (
        <p className="muted">No requests yet.</p>
      ) : (
        <>
          <p className="muted" style={{ marginBottom: '0.75rem' }}>
            Select up to two to compare.
          </p>
          <ul className="request-list card">
            {requests.map(({ request, paidCount, totalCount }) => (
              <li key={request._id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(request._id)}
                    onChange={() => toggleSelect(request._id)}
                  />
                  <span style={{ flex: 1 }}>{request.memo}</span>
                  <span className="amount-small">{formatLunaAsNim(request.total_amount)}</span>
                  <span className="muted">
                    {paidCount}/{totalCount} paid
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      {selected.length > 0 && (
        <div className="compare-grid">
          {selected.map((id) => (
            <RequestDetail key={id} requestId={id} />
          ))}
        </div>
      )}
    </main>
  )
}
