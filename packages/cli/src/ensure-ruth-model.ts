import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { LOCAL_OLLAMA_ORIGIN, normalizeOllamaOrigin, preferLoopbackHost } from "@ruth/util/ollama-origin"

/** Bundled GGUF digest for the default `ruth` model (Qwen3 1.7B abliterated). */
export const RUTH_MODEL_BLOB = "sha256:11e56b54062941d7c415ddb083375eb227004b3c23134d340d0cd9c334b73662"

export const RUTH_SYSTEM = `You are Ruth, a coding agent. Your name is Ruth — never Qwen, Qwen3, or any other model name. If asked your name or who you are, answer only that you are Ruth.

Be brief and concrete. Do not show chain-of-thought.

When you need to create or overwrite a file, call the write tool.
- path is the filename only (for example hello.txt)
- content is the exact text to put inside the file, never the filename

Example:
User: write hello Ruth to hello.txt
You call write with path="hello.txt" and content="hello Ruth"
The file hello.txt then contains exactly: hello Ruth

Never put the filename in the file contents unless the user asked for that text. Do not add quotes, markdown, or extra lines the user did not ask for.

Tools: when you need a tool, make a real tool call. Do not write tool JSON or XML in your reply. If you cannot call a tool natively, emit a single JSON object of the form {"name":"<tool>","arguments":{...}} and nothing else.

Coding rules:
- Read a file before you edit it.
- Make the smallest correct change.
- After a tool result, keep going until the request is done.
- If a tool fails, change approach once; do not repeat the same call with the same arguments.`

const DEFAULT_TEMPLATE = `{{- $lastUserIdx := -1 -}}
{{- range $idx, $msg := .Messages -}}
{{- if eq $msg.Role "user" }}{{ $lastUserIdx = $idx }}{{ end -}}
{{- end }}
{{- if or .System .Tools }}<|im_start|>system
{{ if .System }}
{{ .System }}
{{- end }}
{{- if .Tools }}

# Tools

You may call one or more functions to assist with the user query.

You are provided with function signatures within <tools></tools> XML tags:
<tools>
{{- range .Tools }}
{"type": "function", "function": {{ .Function }}}
{{- end }}
</tools>

For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:
<tool_call>
{"name": <function-name>, "arguments": <args-json-object>}
</tool_call>
{{- end -}}
<|im_end|>
{{ end }}
{{- range $i, $_ := .Messages }}
{{- $last := eq (len (slice $.Messages $i)) 1 -}}
{{- if eq .Role "user" }}<|im_start|>user
{{ .Content }}
{{- if and $.IsThinkSet (eq $i $lastUserIdx) }}
   {{- if $.Think -}}
      {{- " "}}/think
   {{- else -}}
      {{- " "}}/no_think
   {{- end -}}
{{- end }}<|im_end|>
{{ else if eq .Role "assistant" }}<|im_start|>assistant
{{ if (and $.IsThinkSet (and .Thinking (or $last (gt $i $lastUserIdx)))) -}}
<think>{{ .Thinking }}</think>
{{ end -}}
{{ if .Content }}{{ .Content }}
{{- else if .ToolCalls }}<tool_call>
{{ range .ToolCalls }}{"name": "{{ .Function.Name }}", "arguments": {{ .Function.Arguments }}}
{{ end }}</tool_call>
{{- end }}{{ if not $last }}<|im_end|>
{{ end }}
{{- else if eq .Role "tool" }}<|im_start|>user
<tool_response>
{{ .Content }}
</tool_response><|im_end|>
{{ end }}
{{- if and (ne .Role "assistant") $last }}<|im_start|>assistant
{{ if and $.IsThinkSet (not $.Think) -}}
<think>

</think>

{{ end -}}
{{ end }}
{{- end }}`

export type EnsureRuthModelResult = {
  readonly ok: boolean
  readonly created: boolean
  readonly origin: string
  readonly reason?: string
}

export function modelBundleDirs(home = os.homedir()): string[] {
  const extra = process.env.RUTH_MODEL_DIR
  const xdg = process.env.XDG_DATA_HOME
  return [
    extra,
    xdg ? path.join(xdg, "ruth", "models") : undefined,
    path.join(home, ".local", "share", "ruth", "models"),
    process.env.OLLAMA_MODELS,
    path.join(home, ".ollama", "models"),
  ].filter((dir): dir is string => Boolean(dir))
}

function blobFile(dir: string, digest: string) {
  const id = digest.replace(/^sha256:/, "")
  return path.join(dir, "blobs", `sha256-${id}`)
}

export function findModelBlob(dirs = modelBundleDirs()): string | undefined {
  const digest = RUTH_MODEL_BLOB
  for (const dir of dirs) {
    const file = blobFile(dir, digest)
    try {
      if (fs.statSync(file).isFile()) return file
    } catch {
      // try the next known location
    }
  }
  return undefined
}

function readSiblingTemplate(blobPath: string): string | undefined {
  const dir = path.dirname(blobPath)
  const known = "sha256-ae370d884f108d16e7cc8fd5259ebc5773a0afa6e078b11f4ed7e39a27e0dfc4"
  try {
    const text = fs.readFileSync(path.join(dir, known), "utf8")
    if (text.includes("im_start")) return text
  } catch {
    // use the bundled default
  }
  return undefined
}

export function hasRuthModel(names: readonly string[]): boolean {
  return names.some((name) => {
    const bare = name.replace(/:latest$/, "")
    return bare === "ruth"
  })
}

export function listModelNames(payload: unknown): string[] {
  if (!payload || typeof payload !== "object" || !("models" in payload)) return []
  const models = (payload as { models?: unknown }).models
  if (!Array.isArray(models)) return []
  return models.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const rec = item as { name?: unknown; model?: unknown }
    return [rec.name, rec.model].filter((value): value is string => typeof value === "string")
  })
}

export function ruthModelfile(options: { readonly blobDigest?: string; readonly template?: string } = {}) {
  const digest = options.blobDigest ?? RUTH_MODEL_BLOB
  const template = options.template ?? DEFAULT_TEMPLATE
  return `FROM ${digest}
TEMPLATE """${template}"""
SYSTEM """${RUTH_SYSTEM}"""
PARAMETER temperature 0.2
PARAMETER num_ctx 16384
PARAMETER top_k 20
PARAMETER top_p 0.95
PARAMETER stop <|im_start|>
PARAMETER stop <|im_end|>
`
}

async function fetchJson(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 8_000, ...rest } = init
  const response = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) })
  const text = await response.text()
  let json: unknown
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    json = text
  }
  return { ok: response.ok, status: response.status, json, text }
}

async function uploadBlob(origin: string, file: string, digest: string) {
  const url = `${origin}/api/blobs/${digest}`
  const head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5_000) }).catch(() => undefined)
  if (head?.ok) return
  const body = fs.readFileSync(file)
  const put = await fetch(url, {
    method: "POST",
    body,
    headers: { "content-type": "application/octet-stream" },
    signal: AbortSignal.timeout(600_000),
  })
  if (!put.ok) {
    const retry = await fetch(url, {
      method: "PUT",
      body,
      headers: { "content-type": "application/octet-stream" },
      signal: AbortSignal.timeout(600_000),
    })
    if (!retry.ok) throw new Error(`Failed to upload model blob (${retry.status})`)
  }
}

export async function ensureRuthModel(
  options: { readonly origin?: string; readonly modelDir?: string; readonly home?: string } = {},
): Promise<EnsureRuthModelResult> {
  const origin = normalizeOllamaOrigin(preferLoopbackHost(options.origin ?? LOCAL_OLLAMA_ORIGIN))
  try {
    const tags = await fetchJson(`${origin}/api/tags`)
    if (!tags.ok) return { ok: false, created: false, origin, reason: `Ollama at ${origin} returned ${tags.status}` }
    if (hasRuthModel(listModelNames(tags.json))) return { ok: true, created: false, origin }
  } catch (error) {
    return { ok: false, created: false, origin, reason: error instanceof Error ? error.message : String(error) }
  }

  const dirs = options.modelDir ? [options.modelDir, ...modelBundleDirs(options.home)] : modelBundleDirs(options.home)
  const blob = findModelBlob(dirs)
  if (!blob) return { ok: false, created: false, origin, reason: "bundled ruth model files were not found" }

  try {
    await uploadBlob(origin, blob, RUTH_MODEL_BLOB)
    const modelfile = ruthModelfile({ template: readSiblingTemplate(blob) })
    const created = await fetchJson(`${origin}/api/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "ruth", modelfile, stream: false }),
      timeoutMs: 120_000,
    })
    if (!created.ok) return { ok: false, created: false, origin, reason: created.text || `create failed (${created.status})` }
    const tags = await fetchJson(`${origin}/api/tags`)
    if (!hasRuthModel(listModelNames(tags.json))) {
      return { ok: false, created: true, origin, reason: "ollama create finished but ruth is still missing" }
    }
    return { ok: true, created: true, origin }
  } catch (error) {
    return { ok: false, created: false, origin, reason: error instanceof Error ? error.message : String(error) }
  }
}
