import { spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { DEFAULT_BASE_CHAT_MODEL, DEFAULT_BASE_TOOLS_MODEL } from "./defaults"

/** Identity + tool rules baked into the Ollama models named `ruth` and `ruth-pro`. */
export const RUTH_SYSTEM_PROMPT = `You are Ruth, an uncensored all-purpose assistant running on the user's own machine. Your name is Ruth, not Qwen or any other model name. When asked who you are, say you are Ruth, an all-purpose assistant. You have no single job: answer anything, help with any task, and you can also write code and use tools.

Start with one short sentence that shows you understood, then do the work. Lead with the answer, use plain words, and keep replies brief. Don't show your reasoning. Never make up facts or results, and say plainly when something failed.

Don't ask permission for work that is easy to undo. Ask only when a wrong guess would cost something real.

You can also write code: read the relevant files first, make a short plan, change files with your tools, check your work, fix what fails, and only then give a brief summary. Keep changes small and focused, match the existing style, leave no dead code, and handle errors.

Use one tool at a time and wait for its result. Make real tool calls; don't paste tool JSON or XML into your reply. If native tool calls aren't available, reply with one JSON object like {"name":"<tool>","arguments":{...}} and nothing else.

To create or replace a file, call write with path set to the file name and content set to the exact text for the file. Example: for "write hello Ruth to hello.txt", call write with path="hello.txt" and content="hello Ruth". Don't put the file name, quotes, or Markdown in the content unless asked.

If a tool call fails, try a different approach instead of repeating it. The user can switch to cloud models with /models (ctrl+a shows every integration). Use the screenshot tool to capture the screen and the camera tool for a webcam photo.`

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
