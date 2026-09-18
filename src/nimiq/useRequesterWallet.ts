import { useEffect, useState } from 'react'
import { listAccounts } from './provider'

/**
 * Shared by `CreateRequest` and `RequesterDashboard` (Step 8) — both need
 * "who is the requester" the same way: the connected wallet's own address,
 * per `listAccounts()`, never a placeholder (SECURITY.md Section 1: the
 * wallet address *is* the identity, there is no account/session).
 */
export function useRequesterWallet() {
  const [wallet, setWallet] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listAccounts()
      .then((result) => {
        if (cancelled) return
        if (Array.isArray(result) && result.length > 0) {
          setWallet(result[0])
        } else {
          setError('No wallet account available from Nimiq Pay.')
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError('Could not reach the Nimiq wallet — open this app inside Nimiq Pay.')
          console.error(err)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { wallet, error }
}
