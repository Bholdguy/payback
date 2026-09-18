import { init as sdkInit, type NimiqProvider } from '@nimiq/mini-app-sdk'
import { describeUnknown } from './describeUnknown'

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
export type SendBasicTransactionStage = 'getProvider' | 'call' | 'non-string-result'

export type SendBasicTransactionOutcome =
  | { kind: 'success'; txHash: string; raw: unknown }
  | { kind: 'error'; stage: SendBasicTransactionStage; raw: unknown }

/**
 * @param onLog Optional step-by-step reporter, called at every stage of this
 *   call. Exists because a real device may have no remote debugging attached
 *   (confirmed the case during Step 5's investigation) — `console.log` alone
 *   is then invisible to whoever is testing. Callers that need on-screen
 *   visibility should render each message; `console.log`/`console.error`
 *   still fire unconditionally below for when a console *is* available.
 */
export async function sendBasicTransactionWithData(
  params: SendBasicTransactionParams,
  onLog?: (message: string) => void,
): Promise<SendBasicTransactionOutcome> {
  const log = (message: string) => {
    console.log(`[nimiq/provider] ${message}`)
    onLog?.(message)
  }

  log(`sendBasicTransactionWithData called with params: ${describeUnknown(params)}`)
  log(
    `param types: recipient=${typeof params.recipient} (len=${params.recipient?.length}), value=${typeof params.value} (isInteger=${Number.isInteger(params.value)}), data=${typeof params.data} (len=${params.data?.length})`,
  )

  let provider: NimiqProvider
  try {
    log('awaiting getProvider() (init)…')
    provider = await getProvider()
    log('getProvider() resolved')
  } catch (err) {
    const desc = describeUnknown(err)
    console.error('[nimiq/provider] getProvider() (init) threw:', err)
    log(`getProvider() (init) threw: ${desc}`)
    return { kind: 'error', stage: 'getProvider', raw: err }
  }

  log(`typeof provider.sendBasicTransactionWithData: ${typeof provider.sendBasicTransactionWithData}`)

  let result: unknown
  try {
    log('calling provider.sendBasicTransactionWithData(params)…')
    result = await provider.sendBasicTransactionWithData(params)
    log('provider.sendBasicTransactionWithData(params) returned (did not throw)')
  } catch (err) {
    const desc = describeUnknown(err)
    console.error('[nimiq/provider] sendBasicTransactionWithData threw:', err)
    log(`sendBasicTransactionWithData threw: ${desc}`)
    return { kind: 'error', stage: 'call', raw: err }
  }

  const desc = describeUnknown(result)
  console.log('[nimiq/provider] sendBasicTransactionWithData resolved:', result)
  log(`sendBasicTransactionWithData resolved with: ${desc}`)

  if (typeof result === 'string') {
    return { kind: 'success', txHash: result, raw: result }
  }
  log(`resolved value is not a string tx hash (typeof=${typeof result}) — treating as error`)
  return { kind: 'error', stage: 'non-string-result', raw: result }
}
