import fs from "fs"
import os from "os"
import path from "path"
import { env } from "@opencode/util/env"

export const DEFAULT_CHAT_MODEL = "huihui_ai/qwen3-abliterated:1.7b"
export const DEFAULT_TOOLS_MODEL = "huihui_ai/qwen3-abliterated:4b"
export const DEFAULT_PROVIDER_MODEL = `ollama/${DEFAULT_CHAT_MODEL}`
export const DEFAULT_REPO_SLUG = "the3kingleo-cmyk/ruth-code"

export function defaultRuthConfig(pluginPath?: string) {
  return {
    $schema: "https://opencode.ai/config.json",
    $comment:
      "Default Ruth config for local Ollama. 1.7b is the first-run chat model; prefer 4b when you need tools.",
    model: DEFAULT_PROVIDER_MODEL,
    small_model: DEFAULT_PROVIDER_MODEL,
    plugins: pluginPath ? [pluginPath] : [],
    provider: {
      ollama: {
        options: { headerTimeout: 1_200_000, chunkTimeout: false },
        models: {
          [DEFAULT_TOOLS_MODEL]: { capabilities: { tools: true } },
          [DEFAULT_CHAT_MODEL]: { capabilities: { tools: true } },
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
  "jcode.json",
  "jcode.jsonc",
  "opencode.json",
  "opencode.jsonc",
]

export function findExistingConfig(directory = configDir()): string | undefined {
  for (const name of CONFIG_CANDIDATES) {
    const file = path.join(directory, name)
    if (fs.existsSync(file)) return file
  }
  return undefined
}

/** Write ~/.config/ruth/ruth.json when no Ruth/JCode/OpenCode config exists. */
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
