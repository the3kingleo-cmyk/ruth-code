import fs from "fs"
import { parse } from "jsonc-parser"
import { startOllama } from "@ruth/util/local-servers"
import { findExistingConfig } from "./defaults"

/** The `provider/model` Ruth will use, read straight from the global config. */
function configuredModel() {
  const file = findExistingConfig()
  if (!file) return undefined
  try {
    const config = parse(fs.readFileSync(file, "utf8")) as { model?: unknown } | undefined
    return typeof config?.model === "string" ? config.model : undefined
  } catch {
    return undefined
  }
}

/**
 * Start Ollama in the background when Ruth's model lives there and it is installed but not running, so the first
 * message doesn't fail with "connection refused". Never blocks startup. `RUTH_NO_AUTOSTART=1` turns it off.
 */
export function ensureLocalModelServer() {
  if (process.env.RUTH_NO_AUTOSTART === "1" || process.env.RUTH_NO_AUTOSTART === "true") return
  const model = configuredModel() ?? "ollama/ruth"
  if (!model.startsWith("ollama/")) return
  void startOllama({ waitMs: 20_000 }).catch(() => undefined)
}
