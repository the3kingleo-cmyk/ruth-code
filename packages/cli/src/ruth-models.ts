import { spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { DEFAULT_BASE_CHAT_MODEL, DEFAULT_BASE_TOOLS_MODEL } from "./defaults"

/** Identity + tool/coding rules baked into the Ollama models named `ruth` and `ruth-pro`. */
export const RUTH_SYSTEM_PROMPT = `You are Ruth, David's coding agent. Your name is Ruth — never Qwen, Qwen3, or any other model name. If asked your name or who you are, answer only that you are Ruth.

Be brief and concrete. Do not show chain-of-thought.

You are a coding agent. Plan the change, use tools to read and edit files, then run tests or otherwise verify the result before you stop.

When you need to create or overwrite a file, call the write tool.
- path is the filename only (for example hello.txt)
- content is the exact text to put inside the file, never the filename

Example:
User: write hello Ruth to hello.txt
You call write with path="hello.txt" and content="hello Ruth"
The file hello.txt then contains exactly: hello Ruth

Never put the filename in the file contents unless the user asked for that text. Do not add quotes, markdown, or extra lines the user did not ask for.

Tools: when you need a tool, make a real tool call. Do not write tool JSON or XML in your reply. If you cannot call a tool natively, emit a single JSON object of the form {"name":"<tool>","arguments":{...}} and nothing else.
The user can switch to cloud models with /models (ctrl+a lists integrations). To capture the screen or a webcam photo, use the screenshot or camera tools.

Coding rules:
- Read a file before you edit it.
- Prefer edit or patch for existing files; write only for new files.
- Make the smallest correct change.
- After a tool result, keep going until the request is done.
- After code changes, run tests or a typecheck when you can, and fix failures.
- If a tool fails, change approach once; do not repeat the same call with the same arguments.`

export type EnsureRuthModelsResult = {
  ok: boolean
  ruth: boolean
  ruthPro: boolean
  from: string
  detail: string
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "").trim()
}

function run(args: string[], timeout = 30 * 60 * 1000) {
  return spawnSync("ollama", args, { encoding: "utf8", timeout })
}

export function ollamaHasModel(name: string): boolean {
  const listed = run(["list"], 30_000)
  if (listed.status !== 0) return false
  const names = (listed.stdout || "")
    .split("\n")
    .slice(1)
    .map((line) => line.split(/\s+/)[0])
    .filter(Boolean)
  return names.includes(name) || names.includes(`${name}:latest`)
}

function pullBase(tag: string): { ok: boolean; detail: string } {
  if (ollamaHasModel(tag)) return { ok: true, detail: `already present: ${tag}` }
  const pulled = run(["pull", tag])
  if (pulled.status === 0 && ollamaHasModel(tag)) return { ok: true, detail: `pulled ${tag}` }
  const err = stripAnsi(pulled.stderr || pulled.stdout || "pull failed")
  return { ok: false, detail: err.slice(0, 400) }
}

function writeModelfile(from: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ruth-modelfile-"))
  const file = path.join(dir, "Modelfile")
  fs.writeFileSync(file, `FROM ${from}\nPARAMETER temperature 0.2\nSYSTEM """\n${RUTH_SYSTEM_PROMPT}\n"""\n`)
  return file
}

function createNamed(name: string, from: string): { ok: boolean; detail: string } {
  const file = writeModelfile(from)
  try {
    const created = run(["create", name, "-f", file])
    if (created.status === 0 && ollamaHasModel(name)) {
      return { ok: true, detail: `created ${name} from ${from}` }
    }
    const err = stripAnsi(created.stderr || created.stdout || "create failed")
    return { ok: false, detail: err.slice(0, 400) }
  } finally {
    try {
      fs.rmSync(path.dirname(file), { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
}

/**
 * Build local Ollama models `ruth` and (when possible) `ruth-pro`.
 * Prefers Qwen3 1.7b for `ruth`; falls back to 4b. Never pulls a registry image named `ruth`.
 */
export function ensureRuthModels(): EnsureRuthModelsResult {
  const which = spawnSync("which", ["ollama"], { encoding: "utf8" })
  if (which.status !== 0) {
    return { ok: false, ruth: false, ruthPro: false, from: "", detail: "ollama is not installed or not on PATH" }
  }

  let from = ""
  const small = pullBase(DEFAULT_BASE_CHAT_MODEL)
  if (small.ok) {
    from = DEFAULT_BASE_CHAT_MODEL
  } else {
    const large = pullBase(DEFAULT_BASE_TOOLS_MODEL)
    if (!large.ok) {
      return {
        ok: false,
        ruth: false,
        ruthPro: false,
        from: "",
        detail: `Could not pull ${DEFAULT_BASE_CHAT_MODEL} or ${DEFAULT_BASE_TOOLS_MODEL}. ${small.detail}`,
      }
    }
    from = DEFAULT_BASE_TOOLS_MODEL
  }

  const ruth = ollamaHasModel("ruth") ? { ok: true, detail: "ollama has ruth" } : createNamed("ruth", from)
  if (!ruth.ok) {
    return { ok: false, ruth: false, ruthPro: ollamaHasModel("ruth-pro"), from, detail: ruth.detail }
  }

  let ruthPro = ollamaHasModel("ruth-pro")
  let proDetail = ruthPro ? "ollama has ruth-pro" : ""
  if (!ruthPro) {
    // Do not pull the 4B base during routine doctor runs (slow, and tight on 6.4GB RAM).
    // The installer still pulls it. If 4B is already local, build ruth-pro now.
    if (ollamaHasModel(DEFAULT_BASE_TOOLS_MODEL) || from === DEFAULT_BASE_TOOLS_MODEL) {
      const created = createNamed("ruth-pro", DEFAULT_BASE_TOOLS_MODEL)
      ruthPro = created.ok
      proDetail = created.detail
    } else {
      proDetail = "ruth-pro not installed (needs 4B). Installer builds it when RAM allows."
    }
  }

  const bits = [ruth.detail, proDetail].filter(Boolean)
  return { ok: true, ruth: true, ruthPro, from, detail: bits.join(". ") }
}
