import { useMutation } from 'convex/react'
import { useMemo, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { useRequesterWallet } from '../nimiq/useRequesterWallet'
import { generateRequestLinks } from '../request/RequestLinkGenerator'
import { AmountParseError, formatLunaAsNim, parseNimToLuna } from '../split/amount'
import { SplitCalculatorError, splitCalculator } from '../split/SplitCalculator'

const APP_URL = import.meta.env.VITE_APP_URL as string | undefined

/**
 * Requester-side screen (ARCHITECTURE.md 2.1): collects total, participant
 * count, and memo; previews the per-person split live, client-side, with
 * SplitCalculator; on "Generate" calls the `createRequest` mutation, which
 * re-runs the split server-side and freezes the request permanently.
 */
export function CreateRequest() {
  const createRequest = useMutation(api.requests.createRequest)

  const [totalInput, setTotalInput] = useState('80')
  const [participantCountInput, setParticipantCountInput] = useState('4')
  const [memo, setMemo] = useState('Dinner at Taco Spot')
  const [generated, setGenerated] = useState<{ requestId: string; shares: number[] } | null>(
    null,
  )
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { wallet: requesterWallet, error: walletError } = useRequesterWallet()

  const preview = useMemo(() => {
    try {
      const totalLuna = parseNimToLuna(totalInput)
      const participantCount = Number(participantCountInput)
      if (!Number.isInteger(participantCount)) {
        throw new SplitCalculatorError('participant count must be a whole number')
      }
      const shares = splitCalculator({ total: totalLuna, participantCount })
      return { shares, totalLuna, error: null as string | null }
    } catch (err) {
      if (err instanceof AmountParseError || err instanceof SplitCalculatorError) {
        return { shares: null, totalLuna: null, error: err.message }
      }
      throw err
    }
  }, [totalInput, participantCountInput])

  const canGenerate =
    preview.shares !== null && memo.trim() !== '' && !isSubmitting && requesterWallet !== null

  if (generated) {
    const links = APP_URL ? generateRequestLinks(generated.requestId, APP_URL) : null

    return (
      <main className="screen stack">
        <div className="card stack">
          <h1>Request sent</h1>
          <p className="muted">This amount is locked in — sharing the link won't change it.</p>
          <ul className="participant-list">
            {generated.shares.map((share, i) => (
              <li key={i} className="participant-row">
                <span>Person {i + 1}</span>
                <span className="amount-small">{formatLunaAsNim(share)}</span>
              </li>
            ))}
          </ul>
        </div>

        {links ? (
          <a className="btn btn-primary" href={links.nimiqPayDeeplink}>
            Share link
          </a>
        ) : (
          <p className="alert alert-error">Sharing isn't set up for this deployment yet.</p>
        )}

        <button type="button" className="btn btn-secondary" onClick={() => setGenerated(null)}>
          Back
        </button>
      </main>
    )
  }

  return (
    <main className="screen">
      <a className="top-link" href="/dashboard">
        Your requests
      </a>

      <h1>Request money</h1>
      <p className="muted" style={{ marginBottom: '1.25rem' }}>
        Split a bill and get paid straight to your account.
      </p>

      <div className="stack">
        <div className="field">
          <label htmlFor="total">Total amount (NIM)</label>
          <input
            id="total"
            type="text"
            inputMode="decimal"
            value={totalInput}
            onChange={(e) => setTotalInput(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="participants">Split between how many people?</label>
          <input
            id="participants"
            type="text"
            inputMode="numeric"
            value={participantCountInput}
            onChange={(e) => setParticipantCountInput(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="memo">What's it for?</label>
          <input
            id="memo"
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Dinner at Taco Spot"
          />
        </div>

        <div className="card">
          <h2>Each person pays</h2>
          {preview.shares ? (
            <ul className="participant-list">
              {preview.shares.map((share, i) => (
                <li key={i} className="participant-row">
                  <span>Person {i + 1}</span>
                  <span className="amount-small">{formatLunaAsNim(share)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="alert alert-error">{preview.error}</p>
          )}
        </div>

        {walletError && <p className="alert alert-error">{walletError}</p>}
        {submitError && <p className="alert alert-error">{submitError}</p>}

        <button
          type="button"
          className="btn btn-primary"
          disabled={!canGenerate}
          onClick={async () => {
            if (!preview.shares || preview.totalLuna === null || !requesterWallet) return
            setIsSubmitting(true)
            setSubmitError(null)
            try {
              const requestId = await createRequest({
                requesterWallet,
                total: preview.totalLuna,
                memo: memo.trim(),
                participantCount: Number(participantCountInput),
              })
              setGenerated({ requestId, shares: preview.shares })
            } catch (err) {
              setSubmitError(err instanceof Error ? err.message : String(err))
            } finally {
              setIsSubmitting(false)
            }
          }}
        >
          {isSubmitting ? 'Sending…' : 'Request'}
        </button>
      </div>
    </main>
  )
}
