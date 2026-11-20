export * as RepeatGuard from "./repeat-guard.js"

const failed = new Map<string, Set<string>>()

function fingerprint(name: string, input: unknown) {
  try {
    return `${name}:${JSON.stringify(input)}`
  } catch {
    return `${name}:${String(input)}`
  }
}

function bucket(sessionID: string) {
  const existing = failed.get(sessionID)
  if (existing) return existing
  const next = new Set<string>()
  failed.set(sessionID, next)
  return next
}

export function alreadyFailed(sessionID: string, name: string, input: unknown) {
  return bucket(sessionID).has(fingerprint(name, input))
}

export function rememberFailure(sessionID: string, name: string, input: unknown) {
  bucket(sessionID).add(fingerprint(name, input))
}

export function clear(sessionID: string) {
  failed.delete(sessionID)
}

export const REPEAT_MESSAGE =
  "This exact tool call already failed. Do not repeat it. Read the previous error and try a different approach, or tell the user what went wrong."
