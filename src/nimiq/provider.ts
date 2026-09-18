import { init as sdkInit, type NimiqProvider } from '@nimiq/mini-app-sdk'

/**
 * Wraps `@nimiq/mini-app-sdk` (ARCHITECTURE.md 2.2). `init()` is called once
 * and cached; every other call awaits it.
 */
let providerPromise: Promise<NimiqProvider> | null = null

/**
 * The installed SDK's `init()` checks `window.nimiq` synchronously before
 * falling back to a poll-until-timeout (`dist/index.js`: `window.nimiq
 * ? Promise.resolve(window.nimiq) : ...`). This lets a screen check
 * synchronously, without waiting out a timeout, whether it's worth calling
 * `init()` at all — used for the blocked-path UI (PayerView).
 */
export function isInsideNimiqPay(): boolean {
  return typeof window !== 'undefined' && window.nimiq !== undefined
}

export function getProvider(): Promise<NimiqProvider> {
  if (!providerPromise) {
    providerPromise = sdkInit({ timeout: 10_000 })
  }
  return providerPromise
}

export async function listAccounts() {
  const provider = await getProvider()
  return provider.listAccounts()
}

export async function isConsensusEstablished() {
  const provider = await getProvider()
  return provider.isConsensusEstablished()
}

export async function getBlockNumber() {
  const provider = await getProvider()
  return provider.getBlockNumber()
}

export interface SendBasicTransactionParams {
  recipient: string
  value: number
  data: string
  fee?: number
  validityStartHeight?: number
}

/**
 * Normalized outcome of `sendBasicTransactionWithData`.
 *
 * PRD.md Section 0 cites `nimiq.dev/mini-apps/api-reference/nimiq-provider`
 * as documenting `PermissionDeniedError`/`InvalidTransactionError` thrown on
 * cancel/insufficient-balance. Neither class exists anywhere in the installed
 * `@nimiq/mini-app-sdk@0.1.0` source (checked `dist/provider.d.ts` and the
 * bundled `.js`/`.cjs` — grepped for both names, zero matches). The package's
 * own static types show `sendBasicTransactionWithData` *resolving* to
 * `string | ErrorResponse` (`ErrorResponse = { error: { type: string;
 * message: string } }`), never throwing a named class. This is plausible
 * without being a contradiction — the SDK is a thin RPC relay, and the actual
 * error behavior is produced by whatever adapter Nimiq Pay injects into the
 * WebView at runtime, which this package's static types can't capture. Until
 * verified on a real device, this wrapper defends both possibilities: a
 * thrown value of unknown shape, or a resolved `ErrorResponse`. Both paths
 * are logged in full and returned as `raw`, unmodified, so a real device
 * test's actual output can be captured and compared against this comment
 * rather than guessed at again later.
 */
export type SendBasicTransactionOutcome =
  | { kind: 'success'; txHash: string; raw: unknown }
  | { kind: 'error'; raw: unknown }

export async function sendBasicTransactionWithData(
  params: SendBasicTransactionParams,
): Promise<SendBasicTransactionOutcome> {
  const provider = await getProvider()

  let result: unknown
  try {
    result = await provider.sendBasicTransactionWithData(params)
  } catch (err) {
    console.error('[nimiq/provider] sendBasicTransactionWithData threw:', err)
    return { kind: 'error', raw: err }
  }

  console.log('[nimiq/provider] sendBasicTransactionWithData resolved:', result)

  if (typeof result === 'string') {
    return { kind: 'success', txHash: result, raw: result }
  }
  return { kind: 'error', raw: result }
}
