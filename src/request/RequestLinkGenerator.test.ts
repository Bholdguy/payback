import { describe, expect, it } from 'vitest'
import { generateRequestLinks } from './RequestLinkGenerator'

describe('generateRequestLinks', () => {
  it('builds both documented deeplink formats around the app request URL', () => {
    const links = generateRequestLinks('abc123', 'https://payback-jet.vercel.app')
    expect(links.appRequestUrl).toBe('https://payback-jet.vercel.app/r/abc123')
    expect(links.nimiqPayDeeplink).toBe(
      `nimiqpay://miniapp?url=${encodeURIComponent('https://payback-jet.vercel.app/r/abc123')}`,
    )
    expect(links.httpsDeeplink).toBe(
      `https://nimpay.app/miniapps/open/${encodeURIComponent('https://payback-jet.vercel.app/r/abc123')}`,
    )
  })

  it('strips a trailing slash on the app URL so links never contain a double slash', () => {
    const links = generateRequestLinks('abc123', 'https://payback-jet.vercel.app/')
    expect(links.appRequestUrl).toBe('https://payback-jet.vercel.app/r/abc123')
  })

  it('is deterministic for the same request id and app url', () => {
    const a = generateRequestLinks('abc123', 'https://payback-jet.vercel.app')
    const b = generateRequestLinks('abc123', 'https://payback-jet.vercel.app')
    expect(a).toEqual(b)
  })
})
