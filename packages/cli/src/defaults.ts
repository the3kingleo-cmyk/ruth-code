import fs from "fs"
import os from "os"
import path from "path"
import { env } from "@opencode/util/env"

export const DEFAULT_CHAT_MODEL = "ruth"
export const DEFAULT_TOOLS_MODEL = "ruth-pro"
/** Base Ollama tags used to build the named Ruth models. Prefer 1.7b for 6.4GB RAM. */
export const DEFAULT_BASE_CHAT_MODEL = "huihui_ai/qwen3-abliterated:1.7b"
export const DEFAULT_BASE_TOOLS_MODEL = "huihui_ai/qwen3-abliterated:4b"
export const DEFAULT_PROVIDER_MODEL = "ollama/ruth"
export const DEFAULT_REPO_SLUG = "the3kingleo-cmyk/ruth-install"

export function defaultRuthConfig(pluginPath?: string) {
  return {
    $comment:
      "Default Ruth config. The local model is named Ruth (Ollama `ruth` on Qwen3 1.7B). Use `ruth-pro` (4B) for heavier tool work.",
    model: DEFAULT_PROVIDER_MODEL,
    small_model: DEFAULT_PROVIDER_MODEL,
    websearch: { provider: "random" },
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
    plugins: [],
    provider: {
      ollama: {
        options: { headerTimeout: 1_200_000 },
        models: {
          [DEFAULT_CHAT_MODEL]: { tool_call: true },
          [DEFAULT_TOOLS_MODEL]: { tool_call: true },
          [DEFAULT_BASE_TOOLS_MODEL]: { tool_call: true },
          [DEFAULT_BASE_CHAT_MODEL]: { tool_call: true },
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
  if (existing) return { path: existing, created: false }
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, "ruth.json")
  fs.writeFileSync(file, `${JSON.stringify(defaultRuthConfig(options?.pluginPath), null, 2)}\n`)
  return { path: file, created: true }
}
