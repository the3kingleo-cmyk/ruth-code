export * as CloneFallback from "./clone-fallback.js"

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { commandOnPath, githubCloneUrl, GIT_MISSING_HINT } from "../../tool/plugin/shell-rewrite.js"

const CLONE_RE =
  /^(?:(?:please|kindly)\s+)?(?:(?:run|execute)\s+)?(?:gh\s+repo\s+clone|git\s+clone|clone)\s+(\S+)(?:\s+(\S+))?$/i

export function parseCloneRequest(text: string) {
  const cleaned = text.trim().replace(/[.!]+$/, "").trim()
  const match = CLONE_RE.exec(cleaned)
  if (!match?.[1]) return undefined
  const dest = match[2] && !match[2].startsWith("-") ? match[2] : undefined
  const flags = match[2]?.startsWith("-") ? [match[2]] : []
  return { url: githubCloneUrl(match[1]), dest, flags }
}

export function defaultCloneDir(url: string) {
  const base = url.replace(/\/+$/, "").split("/").pop() ?? "repo"
  return base.replace(/\.git$/i, "") || "repo"
}

export function alreadyClonedWithTool(messages: ReadonlyArray<{ readonly type?: string; readonly content?: unknown; readonly command?: string }>) {
  let lastUser = -1
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.type === "user") lastUser = i
  }
  for (let i = lastUser + 1; i < messages.length; i++) {
    const message = messages[i] as { type?: string; command?: string; content?: unknown }
    if (message.type === "shell" && /\b(git\s+clone|gh\s+repo\s+clone)\b/.test(message.command ?? "")) return true
    if (!Array.isArray(message.content)) continue
    for (const part of message.content as Array<{ type?: string; name?: string; input?: { command?: unknown }; state?: { input?: { command?: unknown } } }>) {
      const command = part?.input?.command ?? part?.state?.input?.command
      if (part?.name === "shell" && typeof command === "string" && /\b(git\s+clone|gh\s+repo\s+clone)\b/.test(command))
        return true
    }
  }
  return false
}

export function fulfillCloneRequest(
  text: string,
  cwd: string,
  options?: { alreadyCloned?: boolean },
) {
  const request = parseCloneRequest(text)
  if (!request || options?.alreadyCloned) return { ran: false as const, ok: true as const, output: "" }
  const dest = request.dest ?? defaultCloneDir(request.url)
  if (existsSync(path.join(path.resolve(cwd, dest), ".git"))) return { ran: false as const, ok: true as const, output: "" }
  if (!commandOnPath("git")) {
    return { ran: false as const, ok: false as const, output: GIT_MISSING_HINT }
  }
  const args = ["clone", "--depth", "1", request.url, ...(request.dest ? [request.dest] : []), ...request.flags]
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 180_000 })
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
  const ok = result.status === 0
  return { ran: true as const, ok, output: output || (ok ? `Cloned ${request.url}` : "git clone failed") }
}
