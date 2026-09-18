/**
 * Builds both documented Nimiq Pay deeplink formats (PRD.md Section 0 /
 * ARCHITECTURE.md) for a given request, pointing at this app's own
 * per-request read-only route (`/r/<request_id>`) under `appUrl`.
 */
export interface RequestLinks {
  appRequestUrl: string
  nimiqPayDeeplink: string
  httpsDeeplink: string
}

export function generateRequestLinks(requestId: string, appUrl: string): RequestLinks {
  const trimmedAppUrl = appUrl.replace(/\/+$/, '')
  const appRequestUrl = `${trimmedAppUrl}/r/${requestId}`
  const encoded = encodeURIComponent(appRequestUrl)

  return {
    appRequestUrl,
    nimiqPayDeeplink: `nimiqpay://miniapp?url=${encoded}`,
    httpsDeeplink: `https://nimpay.app/miniapps/open/${encoded}`,
  }
}
