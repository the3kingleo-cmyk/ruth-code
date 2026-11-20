import { spawn, spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"

/** Turn a typed address into an origin Ruth can probe. */
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

async function ollamaUp(origin: string, timeoutMs: number) {
  try {
    const response = await fetch(`${origin}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    })
    return response.ok
  } catch {
    return false
  }
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
  if (await ollamaUp(origin, 800)) return { started: false, running: true }
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
    await new Promise((resolve) => setTimeout(resolve, 300).unref?.())
    if (await ollamaUp(origin, 800)) return { started: true, running: true }
  }
  return { started: true, running: false }
}

/** Synchronous check used where an async probe is not possible. */
export function ollamaInstalled() {
  if (findOllama()) return true
  return spawnSync(process.platform === "win32" ? "where" : "which", ["ollama"], { stdio: "ignore" }).status === 0
}
