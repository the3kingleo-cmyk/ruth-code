import fs from "fs"
import path from "path"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import {
  KNOWN_LOCAL_SERVERS,
  ollamaInstalled,
  probeServer,
  scanLocalServers,
  startOllama,
  type LocalServer,
} from "@ruth/util/local-servers"
import { configDir, ensureDefaultConfig, findExistingConfig } from "./defaults"

/** The address each provider plugin looks at when no `baseURL` is configured. */
const DEFAULT_BASE_URL: Partial<Record<LocalServer["kind"], string>> = {
  ollama: "http://127.0.0.1:11434/v1",
  lmstudio: "http://127.0.0.1:1234/v1",
  "llama.cpp": "http://127.0.0.1:8080/v1",
  vllm: "http://127.0.0.1:8000/v1",
}

const sameURL = (a: string, b: string) =>
  a.replace("localhost", "127.0.0.1").replace(/\/+$/, "") === b.replace("localhost", "127.0.0.1").replace(/\/+$/, "")

/** The model to use by default from a server: Ruth's own model when it is there, else the first one. */
export function preferredModel(server: LocalServer) {
  return server.models.find((model) => model === "ruth") ?? server.models.find((model) => /^ruth\b/.test(model)) ?? server.models[0]
}

/** Edits that point Ruth at `server`, preserving comments and formatting in the config file. */
export function connectConfig(text: string, server: LocalServer, model?: string) {
  const errors: ParseError[] = []
  const current = (parse(text || "{}", errors, { allowTrailingComma: true }) ?? {}) as Record<string, unknown>
  if (errors.length > 0) throw new Error("The Ruth config file is not valid JSON; fix it or run `ruth doctor`.")
  const options = { formattingOptions: { insertSpaces: true, tabSize: 2 } }
  let next = text.trim() === "" ? "{}\n" : text
  // A legacy `provider.<id>` block for the same provider would conflict with the new `providers.<id>` entry.
  const legacy = current.provider as Record<string, unknown> | undefined
  if (legacy && typeof legacy === "object" && server.kind in legacy)
    next = applyEdits(
      next,
      modify(next, Object.keys(legacy).length === 1 ? ["provider"] : ["provider", server.kind], undefined, options),
    )
  const fallback = DEFAULT_BASE_URL[server.kind]
  const baseURL = fallback && sameURL(fallback, server.baseURL) ? undefined : server.baseURL
  const providers = current.providers as Record<string, { settings?: { baseURL?: unknown } }> | undefined
  const configured = providers?.[server.kind]?.settings?.baseURL !== undefined
  // The default address needs no setting; a stale one for another address is removed.
  if (baseURL !== undefined || configured)
    next = applyEdits(next, modify(next, ["providers", server.kind, "settings", "baseURL"], baseURL, options))
  if (model) next = applyEdits(next, modify(next, ["model"], `${server.kind}/${model}`, options))
  return next
}

export type ConnectResult =
  | { readonly type: "connected"; readonly server: LocalServer; readonly model?: string; readonly file: string; readonly started?: boolean }
  | { readonly type: "not-found"; readonly url?: string; readonly ollamaInstalled: boolean }

/**
 * Find a local model server (or probe `url`), then write it to Ruth's config. Starts Ollama when it is installed
 * but not running.
 */
export async function connect(input: { readonly url?: string; readonly model?: string; readonly apiKey?: string }) {
  let started = false
  let server: LocalServer | undefined
  if (input.url) {
    server = await probeServer(input.url, { apiKey: input.apiKey, timeoutMs: 4000 })
    if (!server && /(?:^|:\/\/)(?:127\.0\.0\.1|localhost)(?::11434)?(?:\/|$)/.test(input.url)) {
      started = (await startOllama({ origin: input.url })).running
      if (started) server = await probeServer(input.url, { timeoutMs: 4000 })
    }
  } else {
    let found = await scanLocalServers()
    if (found.length === 0 && ollamaInstalled()) {
      started = (await startOllama()).running
      if (started) found = await scanLocalServers()
    }
    server = found.find((item) => item.models.length > 0) ?? found[0]
  }
  if (!server) return { type: "not-found", url: input.url, ollamaInstalled: ollamaInstalled() } satisfies ConnectResult

  if (input.model && server.models.length > 0 && !server.models.includes(input.model))
    throw new Error(`${server.name} at ${server.baseURL} has no model "${input.model}". It has: ${server.models.join(", ")}`)
  const model = input.model ?? (input.url ? preferredModel(server) : undefined)
  const { path: file } = ensureDefaultConfig()
  const text = fs.readFileSync(file, "utf8")
  const next = connectConfig(text, server, model)
  if (next !== text) fs.writeFileSync(file, next)
  return { type: "connected", server, model, file, started } satisfies ConnectResult
}

export function formatConnect(result: ConnectResult) {
  if (result.type === "not-found") {
    const lines = result.url
      ? [`No model server answered at ${result.url}.`, "Check the address and that the server is running."]
      : [
          "No local model server found on " + KNOWN_LOCAL_SERVERS.map((item) => `${item.port} (${item.hint})`).join(", ") + ".",
          result.ollamaInstalled
            ? "Ollama is installed but did not start. Try `ollama serve` in another terminal."
            : "Install one: Ollama (https://ollama.com), LM Studio (https://lmstudio.ai) or llama.cpp's llama-server.",
          "Then run `ruth connect`, or `ruth connect <url>` for a server elsewhere.",
        ]
    return lines.join("\n")
  }
  const { server } = result
  return [
    `◆ Connected to ${server.name} at ${server.baseURL}${result.started ? " (started it for you)" : ""}`,
    server.models.length > 0
      ? `  Models: ${server.models.slice(0, 12).join(", ")}${server.models.length > 12 ? ` and ${server.models.length - 12} more` : ""}`
      : "  No models yet. Load or pull one, and Ruth lists it automatically.",
    result.model ? `  Default model: ${server.kind}/${result.model}` : undefined,
    `  Config: ${path.relative(process.cwd(), result.file).startsWith("..") ? result.file : path.relative(process.cwd(), result.file)}`,
  ]
    .filter((line) => line !== undefined)
    .join("\n")
}

export { configDir, findExistingConfig }
