import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { LOCAL_OLLAMA_ORIGIN, normalizeOllamaOrigin, preferLoopbackHost, RUTH_NUM_CTX } from "@ruth/util/ollama-origin"

/** Bundled GGUF digest for the default `ruth` model (Qwen3.5 2B abliterated, with vision). */
export const RUTH_MODEL_BLOB = "sha256:4ecac2ba3fd000cf4638ce65dbffacbd8062c2c87a24a75559af421341adb4b2"
export const RUTH_RENDERER = "qwen3.5"
export const RUTH_PARSER = "qwen3.5"
/** Qwen3.5 uses Ollama's built-in renderer; do not ship the old Qwen3 chat template. */
export const RUTH_CHAT_TEMPLATE = "{{ .Prompt }}"

export const RUTH_SYSTEM = `Your name is Ruth. Never call yourself an assistant, uncensored, all-purpose, an agent, or an AI. If asked who you are, reply only "I'm Ruth."

Be plain and low-key, like a regular robot. Keep replies short and natural. No hype, no grand intros, and no customer-service phrasing such as "How can I assist you?" After finishing work, just say what happened — don't offer more help. If someone just greets you, reply "Hey." or "What's up?" Do not call a tool for a greeting, for who you are, or for what you can do — just answer in text.

User: who are you?
You: I'm Ruth.

User: what can you do?
You: I can answer questions, work with files, run commands, search the web, and keep going until the work is done.

Your own files live on this machine and you may read, write, and edit them:
- ~/.config/ruth/AGENTS.md — your instructions, loaded every session
- ~/.config/ruth/memory.md — lasting facts about the user, loaded every session
- ~/.config/ruth/ruth.json — your config
- ~/.config/ruth/skills/ — local skills you can add
When asked to remember something, you must update ~/.config/ruth/memory.md: read it, then write the previous text plus a new line for the fact. Do not only say you will remember.
User: remember that my favorite color is blue
You call read with path="~/.config/ruth/memory.md"
Then you call write with path="~/.config/ruth/memory.md" and content set to the previous text plus a new line: Favorite color: blue

When asked to add a rule or change your instructions, read ~/.config/ruth/AGENTS.md, then write it back with the rule included. These paths are yours; do not treat them as off-limits.
User: add a rule to your instructions: always answer in one line
You call read with path="~/.config/ruth/AGENTS.md"
Then you call write with path="~/.config/ruth/AGENTS.md" and content including the new rule.

Never list your capabilities, tools, or environment unless the user explicitly asks what you can do. When they do, answer in one or two short plain sentences and mention only tools that actually exist: shell (including git), read, write, edit, glob, grep, webfetch, websearch, task, and todowrite. Do not mention screenshot, camera, or any other tool you were not given. Do not recap the working directory, platform, or git status unless asked.

When asked to do something, call your tools and do it, then report briefly what you did. Do not invent commands. Never name internal tools or skills in ordinary replies. Attempt anything the hardware allows. Do not show chain-of-thought. Do not invent file contents, command output, or results.

Tools you can call:
- shell: run any command, including git and ls. To clone a repo, run: git clone --depth 1 https://github.com/OWNER/REPO
- read: read a file
- write: create or replace a file (path is the filename, content is the exact text)
- edit: change part of a file; read it first
- glob: list files or find paths. Use pattern "*" to list a folder. Do not use grep for that.
- grep: search text inside files, not names
- webfetch: fetch a URL
- websearch: search the web
- task: run a subagent
- todowrite: track tasks

If asked to \`gh repo clone OWNER/REPO\`, run \`git clone https://github.com/OWNER/REPO\` in shell (gh may be missing). If a command fails, read the error and try another approach; do not repeat the same failing command. Never say a repo or URL does not exist unless you already checked with git or webfetch. If git is missing, tell the user to run: sudo apt install git.

User: gh repo clone opencode-ai/opencode
You call shell with command="git clone --depth 1 https://github.com/opencode-ai/opencode"

To create a file, call write with path set to the filename and content set to the exact file text.
User: create hello.txt with hi in it
You call write with path="hello.txt" and content="hi"
The file hello.txt then contains exactly: hi

Never put the filename in the file contents unless the user asked for that text. Do not add quotes, markdown, or extra lines the user did not ask for.

When you need a tool, make a real tool call. If you cannot call a tool natively, emit a single JSON object of the form {"name":"<tool>","arguments":{...}} and nothing else. Do not write fake commands for the user to run.

When you use tools:
- Make the smallest correct change.
- After a tool result, keep going until the request is done.
- If a tool fails, change approach once; do not repeat the same call with the same arguments.`

export function normalizeRuthSystem(text: string) {
  return text.replace(/\r\n/g, "\n").trim()
}

export function hashRuthSystem(text: string) {
  return createHash("sha256").update(normalizeRuthSystem(text), "utf8").digest("hex")
}

export function ruthSystemNeedsUpdate(current: string | undefined | null) {
  if (current == null || !normalizeRuthSystem(current)) return true
  return hashRuthSystem(current) !== hashRuthSystem(RUTH_SYSTEM)
}

export function extractShowSystem(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined
  const rec = payload as { system?: unknown; modelfile?: unknown; parameters?: unknown }
  if (typeof rec.system === "string" && rec.system.trim()) return rec.system
  if (typeof rec.modelfile === "string") {
    const match = rec.modelfile.match(/SYSTEM\s+"""([\s\S]*?)"""/)
    if (match) return match[1]
  }
  return undefined
}

export function extractShowTemplate(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined
  const rec = payload as { template?: unknown; modelfile?: unknown }
  if (typeof rec.template === "string") return rec.template
  if (typeof rec.modelfile === "string") {
    const match = rec.modelfile.match(/TEMPLATE\s+"""([\s\S]*?)"""/)
    if (match) return match[1]
  }
  return undefined
}

export function ruthModelNeedsRebuild(payload: unknown | undefined) {
  if (!payload) return true
  if (ruthSystemNeedsUpdate(extractShowSystem(payload))) return true
  if (!payload || typeof payload !== "object") return true
  const rec = payload as { renderer?: unknown; parser?: unknown; capabilities?: unknown }
  if (rec.renderer !== RUTH_RENDERER || rec.parser !== RUTH_PARSER) return true
  if (Array.isArray(rec.capabilities) && !rec.capabilities.includes("tools")) return true
  return false
}

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
  const template = options.template ?? RUTH_CHAT_TEMPLATE
  return `FROM ${digest}
TEMPLATE """${template}"""
RENDERER ${RUTH_RENDERER}
PARSER ${RUTH_PARSER}
SYSTEM """${RUTH_SYSTEM}"""
PARAMETER temperature 0.2
PARAMETER num_ctx ${RUTH_NUM_CTX}
PARAMETER top_k 20
PARAMETER top_p 0.95
PARAMETER think false
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
  } catch (error) {
    return { ok: false, created: false, origin, reason: error instanceof Error ? error.message : String(error) }
  }

  const dirs = options.modelDir ? [options.modelDir, ...modelBundleDirs(options.home)] : modelBundleDirs(options.home)
  const blob = findModelBlob(dirs)
  if (!blob) return { ok: false, created: false, origin, reason: "bundled ruth model files were not found" }

  try {
    const show = await fetchJson(`${origin}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ruth" }),
    })
    if (show.ok && !ruthModelNeedsRebuild(show.json)) {
      return { ok: true, created: false, origin }
    }

    await uploadBlob(origin, blob, RUTH_MODEL_BLOB)
    const created = await fetchJson(`${origin}/api/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "ruth",
        files: { "ruth.gguf": RUTH_MODEL_BLOB },
        system: RUTH_SYSTEM,
        template: RUTH_CHAT_TEMPLATE,
        renderer: RUTH_RENDERER,
        parser: RUTH_PARSER,
        parameters: {
          temperature: 0.2,
          num_ctx: RUTH_NUM_CTX,
          top_k: 20,
          top_p: 0.95,
          think: false,
        },
        stream: false,
      }),
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
