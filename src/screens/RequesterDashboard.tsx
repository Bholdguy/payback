import { useQuery } from 'convex/react'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useRequesterWallet } from '../nimiq/useRequesterWallet'
import { formatLunaAsNim } from '../split/amount'

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
    <li>
      {formatLunaAsNim(shareAmount)} — {participant.status}
      {latestEvent && (
        <span style={{ fontSize: '0.85em', color: '#666' }}>
          {' '}
          (broadcast {new Date(latestEvent.broadcast_at).toLocaleTimeString()}
          {latestEvent.confirmed_at !== null &&
            `, confirmed ${new Date(latestEvent.confirmed_at).toLocaleTimeString()} — ${(
              broadcastToConfirmedLatencyMs! / 1000
            ).toFixed(1)}s`}
          )
        </span>
      )}
    </li>
  )
}

function RequestDetail({ requestId }: { requestId: Id<'requests'> }) {
  const data = useQuery(api.requests.getRequest, { requestId })

  if (data === undefined) return <p>Loading…</p>
  if (data === null) return <p>This request doesn't exist.</p>

  const { request, participants } = data

  return (
    <div style={{ border: '1px solid #ddd', padding: '1rem', flex: '1 1 260px' }}>
      <h3>{formatLunaAsNim(request.total_amount)}</h3>
      <p>{request.memo}</p>
      <p style={{ fontSize: '0.85em', color: '#666' }}>
        Created {new Date(request._creationTime).toLocaleString()}
      </p>
      <ul>
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
 * are selected (Experience C, PRD.md Section 6).
 */
export function RequesterDashboard() {
  const { wallet: requesterWallet, error: walletError } = useRequesterWallet()
  const requests = useQuery(
    api.requests.listRequestsByWallet,
    requesterWallet ? { requesterWallet } : 'skip',
  )
  const [selected, setSelected] = useState<Id<'requests'>[]>([])

  if (walletError) {
    return <p role="alert">{walletError}</p>
  }
  if (requesterWallet === null || requests === undefined) {
    return <p>Loading…</p>
  }

  function toggleSelect(id: Id<'requests'>) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 2) return [prev[1], id]
      return [...prev, id]
    })
  }

  return (
    <main style={{ fontFamily: 'system-ui', padding: '1.5rem' }}>
      <h1>Your requests</h1>
      <p>
        <a href="/">New request</a>
      </p>

      {requests.length === 0 && <p>No requests yet.</p>}

      <ul>
        {requests.map(({ request, paidCount, totalCount }) => (
          <li key={request._id}>
            <label>
              <input
                type="checkbox"
                checked={selected.includes(request._id)}
                onChange={() => toggleSelect(request._id)}
              />{' '}
              {formatLunaAsNim(request.total_amount)} — {request.memo} ({paidCount}/{totalCount}{' '}
              paid)
            </label>
          </li>
        ))}
      </ul>

      {selected.length > 0 && (
        <>
          <h2>{selected.length === 2 ? 'Compare' : 'Detail'}</h2>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            {selected.map((id) => (
              <RequestDetail key={id} requestId={id} />
            ))}
          </div>
        </>
      )}
    </main>
  )
}
