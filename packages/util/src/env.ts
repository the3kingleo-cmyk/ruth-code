/**
 * Jarvis Code environment lookup.
 *
 * Canonical prefix is `JCODE_`. The historical `OPENCODE_` prefix is still
 * accepted as a fallback so existing shells and docs keep working.
 */
export function env(name: string): string | undefined {
  const suffix = name.replace(/^JCODE_/, "").replace(/^OPENCODE_/, "")
  const jcode = process.env[`JCODE_${suffix}`]
  if (jcode !== undefined && jcode !== "") return jcode
  const legacy = process.env[`OPENCODE_${suffix}`]
  if (legacy !== undefined && legacy !== "") return legacy
  return jcode ?? legacy
}

/** Copy each set JCODE_* variable onto the unset OPENCODE_* equivalent. */
export function applyJcodeEnvFallbacks(target: NodeJS.ProcessEnv = process.env): void {
  for (const [key, value] of Object.entries(target)) {
    if (!key.startsWith("JCODE_") || value === undefined) continue
    const legacy = `OPENCODE_${key.slice("JCODE_".length)}`
    if (target[legacy] === undefined) target[legacy] = value
  }
}
