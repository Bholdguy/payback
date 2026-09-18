import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { formatLunaAsNim } from '../split/amount'

/**
 * Read-only render of a frozen request, reached via `/r/<request_id>`
 * (ARCHITECTURE.md 2.1: "renders it ... exactly as stored, with zero local
 * recomputation"). No pay action here yet — that's Step 5's PayerView.
 */
export function RequestView({ requestId }: { requestId: string }) {
  const data = useQuery(api.requests.getRequest, { requestId: requestId as Id<'requests'> })

  if (data === undefined) {
    return <p>Loading…</p>
  }

  if (data === null) {
    return <p>This request doesn't exist.</p>
  }

  const { request, participants } = data

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
        {participants.map((p) => (
          <li key={p._id}>
            {formatLunaAsNim(p.share_amount)} — {p.status}
          </li>
        ))}
      </ul>
    </main>
  )
}
