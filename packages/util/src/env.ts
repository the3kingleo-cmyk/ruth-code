/**
 * Ruth environment lookup.
 *
 * Canonical prefix is `RUTH_`. The earlier `JCODE_` (Jarvis Code) prefix is
 * still accepted as a fallback so existing shells keep working.
 */
const PREFIXES = ["RUTH_", "JCODE_"] as const

export function env(name: string): string | undefined {
  let suffix = name
  for (const prefix of PREFIXES) {
    if (suffix.startsWith(prefix)) {
      suffix = suffix.slice(prefix.length)
      break
    }
  }
  let firstHit: string | undefined
  for (const prefix of PREFIXES) {
    const value = process.env[`${prefix}${suffix}`]
    if (value !== undefined && value !== "") return value
    if (firstHit === undefined && value !== undefined) firstHit = value
  }
  return firstHit
}

/** Copy each set RUTH_* variable onto its unset JCODE_* equivalent. */
export function applyRuthEnvFallbacks(target: NodeJS.ProcessEnv = process.env): void {
  const copy = (fromPrefix: string, toPrefix: string) => {
    for (const [key, value] of Object.entries(target)) {
      if (!key.startsWith(fromPrefix) || value === undefined) continue
      const dest = `${toPrefix}${key.slice(fromPrefix.length)}`
      if (target[dest] === undefined) target[dest] = value
    }
  }
  copy("RUTH_", "JCODE_")
}

/** @deprecated Alias kept for the previous Jarvis Code name. */
export const applyJcodeEnvFallbacks = applyRuthEnvFallbacks
