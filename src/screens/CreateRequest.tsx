import { useMutation } from 'convex/react'
import { useMemo, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { timeGreeting } from '../greeting'
import { useRequesterWallet } from '../nimiq/useRequesterWallet'
import { generateRequestLinks, type RequestLinks } from '../request/RequestLinkGenerator'
import { AmountParseError, formatLunaAsNim, parseNimToLuna } from '../split/amount'
import { SplitCalculatorError, splitCalculator } from '../split/SplitCalculator'

const APP_URL = import.meta.env.VITE_APP_URL as string | undefined

/**
 * The payer link, always shown as visible/selectable text plus a "Copy
 * link" button (Clipboard API) — the one thing that reliably works inside a
 * WebView. `nimiqpay://...` is offered as a secondary option, not the only
 * path: navigating to it from *inside* Nimiq Pay's own WebView (a
 * self-referential custom-scheme link) is exactly the case that silently
 * produced no visible result when this screen briefly relied on it alone.
 */
function ShareLinks({ links }: { links: RequestLinks }) {
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(links.appRequestUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API unavailable/denied — the visible URL text below is
      // the fallback of last resort, so this failure isn't fatal.
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <p className="muted" style={{ marginBottom: '0.4rem' }}>
          Or select the link directly
        </p>
        <p style={{ wordBreak: 'break-all', userSelect: 'all', fontSize: '0.85rem' }}>
          {links.appRequestUrl}
        </p>
      </div>
      <a className="btn btn-secondary" href={links.nimiqPayDeeplink}>
        Open in Nimiq Pay
      </a>
      <button type="button" className="btn btn-primary cta-float" onClick={copyLink}>
        {copied ? 'Copied!' : 'Copy link'}
      </button>
    </div>
  )
}

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
    const total = generated.shares.reduce((a, b) => a + b, 0)

    return (
      <main className="screen stack">
        <div className="card">
          <p className="hero-sub">Request sent — locked in</p>
          <p className="hero-stat">{formatLunaAsNim(total)}</p>
          <p className="hero-sub">Sharing the link won't change this amount.</p>
        </div>

        <ul className="participant-list">
          {generated.shares.map((share, i) => (
            <li key={i} className="participant-card">
              <span className="status-dot" />
              <span className="participant-main">
                <span>Person {i + 1}</span>
              </span>
              <span className="amount-small">{formatLunaAsNim(share)}</span>
            </li>
          ))}
        </ul>

        {links ? <ShareLinks links={links} /> : (
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
      <a className="top-nav" href="/dashboard">
        Your requests
      </a>

      <div className="greeting">
        <h1>
          {timeGreeting()} — let's split a bill
        </h1>
        <p className="muted">Get paid back straight to your account.</p>
      </div>

      <div className="stack">
        <div className="card stack">
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
        </div>

        <div className="card">
          <h2>Each person pays</h2>
          {preview.shares ? (
            <ul className="participant-list">
              {preview.shares.map((share, i) => (
                <li key={i} className="participant-card">
                  <span className="status-dot" />
                  <span className="participant-main">
                    <span>Person {i + 1}</span>
                  </span>
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
          className="btn btn-primary cta-float"
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
          {isSubmitting ? 'Sending…' : 'Generate request'}
        </button>
      </div>
    </main>
  )
}
