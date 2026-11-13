/**
 * Ruth environment lookup.
 *
 * Canonical prefix is `RUTH_`. Earlier `JCODE_` (Jarvis Code) and `OPENCODE_`
 * prefixes are still accepted as fallbacks so existing shells and docs keep working.
 */
const PREFIXES = ["RUTH_", "JCODE_", "OPENCODE_"] as const

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

/** Copy each set RUTH_* (then JCODE_*) variable onto unset older equivalents. */
export function applyRuthEnvFallbacks(target: NodeJS.ProcessEnv = process.env): void {
  const copy = (fromPrefix: string, toPrefix: string) => {
    for (const [key, value] of Object.entries(target)) {
      if (!key.startsWith(fromPrefix) || value === undefined) continue
      const dest = `${toPrefix}${key.slice(fromPrefix.length)}`
      if (target[dest] === undefined) target[dest] = value
    }
  }
  // Newest prefix first so RUTH_* wins, then fill OPENCODE_* from both.
  copy("RUTH_", "JCODE_")
  copy("RUTH_", "OPENCODE_")
  copy("JCODE_", "OPENCODE_")
}

/** @deprecated Alias kept for the previous Jarvis Code name. */
export const applyJcodeEnvFallbacks = applyRuthEnvFallbacks
