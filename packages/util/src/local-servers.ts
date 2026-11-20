import { spawn, spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"

/** Kinds of local model server Ruth knows how to talk to. `local` is any other OpenAI-compatible server. */
export type LocalServerKind = "ollama" | "lmstudio" | "llama.cpp" | "vllm" | "local"

export type LocalServer = {
  readonly kind: LocalServerKind
  readonly name: string
  /** Base URL for the provider's `baseURL` setting (always ends in `/v1`). */
  readonly baseURL: string
  readonly models: ReadonlyArray<string>
}

/** Well-known local addresses, most common first. */
export const KNOWN_LOCAL_SERVERS: ReadonlyArray<{ readonly port: number; readonly hint: string }> = [
  { port: 11434, hint: "Ollama" },
  { port: 1234, hint: "LM Studio" },
  { port: 8080, hint: "llama.cpp / LocalAI" },
  { port: 8000, hint: "vLLM" },
  { port: 1337, hint: "Jan" },
  { port: 5001, hint: "KoboldCpp" },
  { port: 5000, hint: "text-generation-webui / TabbyAPI" },
]

const NAMES: Record<LocalServerKind, string> = {
  ollama: "Ollama",
  lmstudio: "LM Studio",
  "llama.cpp": "llama.cpp",
  vllm: "vLLM",
  local: "OpenAI-compatible server",
}

/** Turn `localhost:1234`, `http://host:1234/v1/` or `http://host:11434/api` into an origin plus path prefix. */
export function normalizeServerURL(input: string): string {
  const raw = /^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim()) ? input.trim() : `http://${input.trim()}`
  const url = new URL(raw)
  const pathname = url.pathname
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/, "")
    .replace(/\/(?:api\/)?v[01]$/, "")
    .replace(/\/api$/, "")
  return `${url.protocol}//${url.host}${pathname}`
}

async function getJson(url: string, timeoutMs: number, apiKey?: string): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json()
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown) => (typeof value === "string" ? value : undefined)

/** Identify the server at `input` and list its models, or return undefined when nothing answers. */
export async function probeServer(
  input: string,
  options: { readonly timeoutMs?: number; readonly apiKey?: string } = {},
): Promise<LocalServer | undefined> {
  const root = normalizeServerURL(input)
  const timeoutMs = options.timeoutMs ?? 1500
  const make = (kind: LocalServerKind, models: ReadonlyArray<string>): LocalServer => ({
    kind,
    name: NAMES[kind],
    baseURL: `${root}/v1`,
    models: [...new Set(models.filter((model) => model.length > 0))].toSorted(),
  })
  const ollama = await getJson(`${root}/api/tags`, timeoutMs, options.apiKey).catch(() => undefined)
  if (ollama !== undefined && Array.isArray(record(ollama).models))
    return make(
      "ollama",
      list(record(ollama).models).flatMap((model) => {
        const name = text(record(model).model) ?? text(record(model).name)
        return name ? [name.replace(/:latest$/, "")] : []
      }),
    )
  const openai = await getJson(`${root}/v1/models`, timeoutMs, options.apiKey).catch(() => undefined)
  if (openai === undefined || !Array.isArray(record(openai).data)) return undefined
  const data = list(record(openai).data).map(record)
  const ids = data.flatMap((model) => (text(model.id) ? [text(model.id)!] : []))
  const owners = new Set(data.map((model) => text(model.owned_by)))
  if (owners.has("llamacpp")) return make("llama.cpp", ids)
  if (owners.has("vllm")) return make("vllm", ids)
  const lmstudio = await getJson(`${root}/api/v0/models`, timeoutMs, options.apiKey).catch(() => undefined)
  if (lmstudio !== undefined && Array.isArray(record(lmstudio).data)) return make("lmstudio", ids)
  return make("local", ids)
}

/** Probe every well-known local port at once. */
export async function scanLocalServers(options: { readonly host?: string; readonly timeoutMs?: number } = {}) {
  const host = options.host ?? "127.0.0.1"
  const found = await Promise.all(
    KNOWN_LOCAL_SERVERS.map((server) =>
      probeServer(`http://${host}:${server.port}`, { timeoutMs: options.timeoutMs ?? 800 }),
    ),
  )
  return found.filter((server): server is LocalServer => server !== undefined)
}

/** Where `ollama` lives, including the per-user install Ruth's installer uses. */
export function findOllama(): string | undefined {
  const exe = process.platform === "win32" ? "ollama.exe" : "ollama"
  const candidates = [
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean),
    path.join(os.homedir(), ".local", "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
    ...(process.platform === "win32" && process.env.LOCALAPPDATA
      ? [path.join(process.env.LOCALAPPDATA, "Programs", "Ollama")]
      : []),
  ].map((dir) => path.join(dir, exe))
  return candidates.find((file) => {
    try {
      return fs.statSync(file).isFile()
    } catch {
      return false
    }
  })
}

/** The context Ruth asks a self-started Ollama to run models with. */
export function ollamaServeContext() {
  const value = Number(process.env.RUTH_OLLAMA_CONTEXT ?? process.env.OLLAMA_CONTEXT_LENGTH ?? 16384)
  return Number.isFinite(value) && value >= 2048 ? Math.floor(value) : 16384
}

/**
 * Start `ollama serve` in the background when Ollama is installed but not running, and wait until it answers.
 * Binds to 127.0.0.1 only and sets a real context length, since Ollama's default 4096 tokens cannot hold Ruth's
 * system prompt and tools.
 */
export async function startOllama(options: { readonly origin?: string; readonly waitMs?: number } = {}) {
  const origin = normalizeServerURL(options.origin ?? "http://127.0.0.1:11434")
  if (await probeServer(origin, { timeoutMs: 800 })) return { started: false, running: true }
  const url = new URL(origin)
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) return { started: false, running: false }
  const binary = findOllama()
  if (!binary) return { started: false, running: false, missing: true }
  const child = spawn(binary, ["serve"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      OLLAMA_HOST: `127.0.0.1:${url.port || "11434"}`,
      OLLAMA_CONTEXT_LENGTH: process.env.OLLAMA_CONTEXT_LENGTH ?? String(ollamaServeContext()),
    },
  })
  child.on("error", () => undefined)
  child.unref()
  const deadline = Date.now() + (options.waitMs ?? 15_000)
  while (Date.now() < deadline) {
    // Unreferenced, so a background start never keeps a finished command alive.
    await new Promise((resolve) => setTimeout(resolve, 300).unref?.())
    if (await probeServer(origin, { timeoutMs: 800 })) return { started: true, running: true }
  }
  return { started: true, running: false }
}

/** Synchronous check used where an async probe is not possible. */
export function ollamaInstalled() {
  if (findOllama()) return true
  return spawnSync(process.platform === "win32" ? "where" : "which", ["ollama"], { stdio: "ignore" }).status === 0
}
