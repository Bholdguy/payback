import { useMemo, useState } from 'react'
import { AmountParseError, formatLunaAsNim, parseNimToLuna } from '../split/amount'
import { SplitCalculatorError, splitCalculator } from '../split/SplitCalculator'

/**
 * Requester-side screen (ARCHITECTURE.md 2.1): collects total, participant
 * count, and memo, and previews the per-person split live, client-side, with
 * SplitCalculator. Nothing is persisted here — request creation/freezing
 * (createRequest mutation, Convex) is Step 4's job, not this screen's.
 */
export function CreateRequest() {
  const [totalInput, setTotalInput] = useState('80')
  const [participantCountInput, setParticipantCountInput] = useState('4')
  const [memo, setMemo] = useState('Dinner at Taco Spot')
  const [generated, setGenerated] = useState<{ shares: number[]; memo: string } | null>(null)

  const preview = useMemo(() => {
    try {
      const totalLuna = parseNimToLuna(totalInput)
      const participantCount = Number(participantCountInput)
      if (!Number.isInteger(participantCount)) {
        throw new SplitCalculatorError('participant count must be a whole number')
      }
      const shares = splitCalculator({ total: totalLuna, participantCount })
      return { shares, error: null as string | null }
    } catch (err) {
      if (err instanceof AmountParseError || err instanceof SplitCalculatorError) {
        return { shares: null, error: err.message }
      }
      throw err
    }
  }, [totalInput, participantCountInput])

  const canGenerate = preview.shares !== null && memo.trim() !== ''

  if (generated) {
    return (
      <main style={{ fontFamily: 'system-ui', padding: '1.5rem' }}>
        <h1>Request generated (local preview only)</h1>
        <p>
          This is a frozen preview, not yet saved anywhere — shareable links and
          cross-device persistence arrive in Step 4.
        </p>
        <p>
          <strong>Memo:</strong> {generated.memo}
        </p>
        <ul>
          {generated.shares.map((share, i) => (
            <li key={i}>
              Participant {i + 1}: {formatLunaAsNim(share)}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setGenerated(null)}>
          Back
        </button>
      </main>
    )
  }

  return (
    <main style={{ fontFamily: 'system-ui', padding: '1.5rem', maxWidth: 420 }}>
      <h1>New request</h1>

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

      <button
        type="button"
        disabled={!canGenerate}
        onClick={() => {
          if (!preview.shares) return
          setGenerated({ shares: preview.shares, memo: memo.trim() })
        }}
      >
        Generate
      </button>
    </main>
  )
}
