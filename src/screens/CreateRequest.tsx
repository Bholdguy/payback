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
      <main style={{ fontFamily: 'system-ui', padding: '1.5rem' }}>
        <h1>Request generated</h1>
        <p>This request is now frozen — sharing this link never changes its amount.</p>
        <ul>
          {generated.shares.map((share, i) => (
            <li key={i}>
              Participant {i + 1}: {formatLunaAsNim(share)}
            </li>
          ))}
        </ul>
        {links ? (
          <>
            <p>
              <a href={links.appRequestUrl}>{links.appRequestUrl}</a>
            </p>
            <p>
              <a href={links.nimiqPayDeeplink}>Open in Nimiq Pay</a>
            </p>
          </>
        ) : (
          <p role="alert">VITE_APP_URL is not set — cannot build a shareable link.</p>
        )}
        <button type="button" onClick={() => setGenerated(null)}>
          Back
        </button>
      </main>
    )
  }

  return (
    <main style={{ fontFamily: 'system-ui', padding: '1.5rem', maxWidth: 420 }}>
      <h1>New request</h1>
      <p>
        <a href="/dashboard">View your requests</a>
      </p>

      <label style={{ display: 'block', marginBottom: '1rem' }}>
        Total (NIM)
        <input
          type="text"
          inputMode="decimal"
          value={totalInput}
          onChange={(e) => setTotalInput(e.target.value)}
        />
      </label>

      <label style={{ display: 'block', marginBottom: '1rem' }}>
        Participants
        <input
          type="text"
          inputMode="numeric"
          value={participantCountInput}
          onChange={(e) => setParticipantCountInput(e.target.value)}
        />
      </label>

      <label style={{ display: 'block', marginBottom: '1rem' }}>
        Memo
        <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} />
      </label>

      <section style={{ marginBottom: '1rem' }}>
        <h2>Preview</h2>
        {preview.shares ? (
          <ul>
            {preview.shares.map((share, i) => (
              <li key={i}>
                Participant {i + 1}: {formatLunaAsNim(share)}
              </li>
            ))}
          </ul>
        ) : (
          <p role="alert">{preview.error}</p>
        )}
      </section>

      {walletError && <p role="alert">{walletError}</p>}
      {submitError && <p role="alert">{submitError}</p>}

      <button
        type="button"
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
        {isSubmitting ? 'Generating…' : 'Generate'}
      </button>
    </main>
  )
}
