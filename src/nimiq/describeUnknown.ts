/**
 * Turns an unknown thrown/resolved value into a readable string for logging
 * and on-screen display. `JSON.stringify` on an `Error` gives `"{}"` (its
 * message/stack aren't own-enumerable), so that case is handled explicitly.
 */
export function describeUnknown(value: unknown): string {
  if (value instanceof Error) {
    const extra = Object.keys(value).filter((k) => k !== 'message' && k !== 'stack')
    const extraObj = Object.fromEntries(extra.map((k) => [k, (value as never)[k]]))
    return `Error(name=${value.name}, message=${JSON.stringify(value.message)}${
      extra.length ? `, extra=${JSON.stringify(extraObj)}` : ''
    })`
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
