import { spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { env } from "./env.js"

/** Default local Ollama bind used when no healthy cloud tunnel is available. */
export const LOCAL_OLLAMA_ORIGIN = "http://127.0.0.1:11434"

export {
  RUTH_CTX_BUCKETS,
  RUTH_CTX_DEFAULT,
  RUTH_CTX_MAX,
  RUTH_CTX_RESERVE,
  RUTH_NUM_CTX,
} from "./ruth-ctx.js"

/** Local side of the Codespace port-forward. Leaves 11434 free for a local Ollama. */
export const DEFAULT_CLOUD_LOCAL_PORT = 11435

/** Remote Ollama port inside the Codespace. */
export const CLOUD_REMOTE_PORT = 11434

export type CloudState = {
  repo?: string
  name?: string
  displayName?: string
  machine?: string
  localPort?: number
  remotePort?: number
  pid?: number
  logFile?: string
  startedAt?: string
  cpus?: number
}

export function stateDir(): string {
  const home = env("TEST_HOME") || os.homedir()
  const xdg = env("XDG_STATE_HOME") || process.env.XDG_STATE_HOME
  return xdg ? path.join(xdg, "ruth") : path.join(home, ".local", "state", "ruth")
}

export function cloudStatePath(): string {
  return path.join(stateDir(), "cloud.json")
}

export function readCloudState(): CloudState | undefined {
  try {
    const json = JSON.parse(fs.readFileSync(cloudStatePath(), "utf8")) as CloudState
    if (json && typeof json === "object") return json
  } catch {
    // no state yet, or a corrupt file — treat as missing
  }
  return undefined
}

export function writeCloudState(state: CloudState): string {
  const dir = stateDir()
  fs.mkdirSync(dir, { recursive: true })
  const file = cloudStatePath()
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`)
  return file
}

export function clearCloudState(): void {
  try {
    fs.unlinkSync(cloudStatePath())
  } catch {
    // already gone
  }
}


/** Prefer IPv4 loopback. `localhost` can resolve to ::1 on some systems (including Crostini) while Ollama binds 127.0.0.1. */
export function preferLoopbackHost(value: string): string {
  return value.replace(/^(https?:\/\/)(localhost|\[::1\]|::1)(?=[:/?#]|$)/i, "$1127.0.0.1")
}

export function normalizeOllamaOrigin(origin: string): string {
  return preferLoopbackHost(origin.replace(/\/+$/, "").replace(/\/v1$/i, ""))
}

export function cloudOriginFromState(state: CloudState): string {
  const port = state.localPort ?? DEFAULT_CLOUD_LOCAL_PORT
  return `http://127.0.0.1:${port}`
}

/** Probe `/api/tags` on an Ollama origin. A short timeout keeps discovery snappy. */
export function probeOllama(origin: string, timeoutMs = 800): boolean {
  const url = `${normalizeOllamaOrigin(origin)}/api/tags`
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000))
  const result = spawnSync("curl", ["-sf", "--max-time", String(seconds), url], {
    encoding: "utf8",
    timeout: timeoutMs + 1_000,
  })
  if (result.status !== 0) return false
  const body = result.stdout || ""
  return body.includes("models") || body.includes("{")
}

/**
 * Prefer a healthy Codespace tunnel (typically localhost:11435). Fall back to
 * local Ollama on localhost:11434 when the tunnel is down or has no state.
 *
 * An explicit `RUTH_OLLAMA_ORIGIN` (with `JCODE_` / `RUTH_` fallbacks) wins
 * over both, so a user can pin a host. `OLLAMA_HOST` is not read here because
 * that variable is the server bind address.
 */
export function resolveOllamaOrigin(options?: { probe?: (origin: string) => boolean; state?: CloudState | undefined }): string {
  const probe = options?.probe ?? ((origin) => probeOllama(origin))
  const pinned = env("OLLAMA_ORIGIN")
  if (pinned && pinned.length > 0) return normalizeOllamaOrigin(pinned)
  const state = options && "state" in options ? options.state : readCloudState()
  if (state) {
    const cloud = cloudOriginFromState(state)
    if (probe(cloud)) return cloud
  }
  return LOCAL_OLLAMA_ORIGIN
}

export function isCloudOrigin(origin: string): boolean {
  try {
    const url = new URL(normalizeOllamaOrigin(origin))
    const port = url.port || (url.protocol === "https:" ? "443" : "80")
    return port === String(DEFAULT_CLOUD_LOCAL_PORT) || port === String(readCloudState()?.localPort ?? "")
  } catch {
    return false
  }
}
