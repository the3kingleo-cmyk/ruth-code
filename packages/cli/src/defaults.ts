import fs from "fs"
import os from "os"
import path from "path"
import { env } from "@ruth/util/env"

export const DEFAULT_CHAT_MODEL = "ruth"
export const DEFAULT_TOOLS_MODEL = "ruth"
/** Base Ollama tag used to build the named `ruth` model. */
export const DEFAULT_BASE_CHAT_MODEL = "huihui_ai/qwen3.5-abliterated:2b"
export const DEFAULT_BASE_TOOLS_MODEL = "huihui_ai/qwen3.5-abliterated:2b"
export const DEFAULT_PROVIDER_MODEL = "ollama/ruth"
export const DEFAULT_REPO_SLUG = ""

export function defaultRuthConfig(pluginPath?: string) {
  return {
    $comment:
      "Default Ruth config. The local model is named Ruth (Ollama `ruth` on uncensored Qwen3.5 2B, with vision).",
    model: DEFAULT_PROVIDER_MODEL,
    small_model: DEFAULT_PROVIDER_MODEL,
    websearch: { provider: "random" },
    permissions: [
      { action: "*", resource: "*", effect: "allow" },
      { action: "external_directory", resource: "~/.config/ruth/**", effect: "allow" },
    ],
    plugins: [],
    update: "disable",
    provider: {
      ollama: {
        package: "@ruth/ai/providers/openai-compatible",
        options: { headerTimeout: 1_200_000, reasoningEffort: "none" },
        models: {
          [DEFAULT_CHAT_MODEL]: { tool_call: true, reasoningEffort: "none" },
        },
      },
    },
  }
}

export function configDir(): string {
  return env("CONFIG_DIR") || path.join(env("XDG_CONFIG_HOME") || path.join(os.homedir(), ".config"), "ruth")
}

const CONFIG_CANDIDATES = [
  "ruth.json",
  "ruth.jsonc",
]

export function findExistingConfig(directory = configDir()): string | undefined {
  for (const name of CONFIG_CANDIDATES) {
    const file = path.join(directory, name)
    if (fs.existsSync(file)) return file
  }
  return undefined
}

/** Write ~/.config/ruth/ruth.json when no Ruth config exists. */
export function ensureDefaultConfig(options?: { pluginPath?: string; directory?: string }): {
  path: string
  created: boolean
} {
  const directory = options?.directory ?? configDir()
  const existing = findExistingConfig(directory)
  if (existing) {
    ensureRuthHomeFiles(directory)
    return { path: existing, created: false }
  }
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, "ruth.json")
  fs.writeFileSync(file, `${JSON.stringify(defaultRuthConfig(options?.pluginPath), null, 2)}\n`)
  ensureRuthHomeFiles(directory)
  return { path: file, created: true }
}

const DEFAULT_AGENTS = `These are Ruth's instructions. Add rules here; they apply to every session.
`

const DEFAULT_MEMORY = `These are lasting facts Ruth should remember about the user.
`

/** Create Ruth's writable memory, instructions, and skills dirs if they are missing. */
export function ensureRuthHomeFiles(directory = configDir()) {
  fs.mkdirSync(directory, { recursive: true })
  fs.mkdirSync(path.join(directory, "skills"), { recursive: true })
  const agents = path.join(directory, "AGENTS.md")
  const memory = path.join(directory, "memory.md")
  if (!fs.existsSync(agents)) fs.writeFileSync(agents, DEFAULT_AGENTS)
  if (!fs.existsSync(memory)) fs.writeFileSync(memory, DEFAULT_MEMORY)
  return { directory, agents, memory }
}
