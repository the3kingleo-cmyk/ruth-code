import { spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { env } from "@opencode/util/env"
import { isLowMemory, readMemAvailableKiB } from "@opencode/util/meminfo"
import {
  configDir,
  DEFAULT_CHAT_MODEL,
  DEFAULT_TOOLS_MODEL,
  ensureDefaultConfig,
  findExistingConfig,
} from "./defaults"
import { shouldEnableFilewatcher } from "./filewatcher-policy"
import { resolveGithubToken } from "./github-release"

export type DoctorCheck = {
  name: string
  ok: boolean
  repaired?: boolean
  detail: string
}

export type DoctorReport = {
  ok: boolean
  checks: DoctorCheck[]
}

const PLUGIN_DIR = "oh-my-openagent"

function home(): string {
  return env("TEST_HOME") || os.homedir()
}

function pluginDist(): string | undefined {
  const dir = path.join(env("XDG_DATA_HOME") || path.join(home(), ".local", "share"), PLUGIN_DIR)
  const file = path.join(dir, "dist", "index.js")
  return fs.existsSync(file) ? dir : undefined
}

function pathHasLocalBin(): boolean {
  const bin = path.join(home(), ".local", "bin")
  return (process.env.PATH ?? "").split(path.delimiter).some((entry) => entry === bin)
}

function ensurePathInBashrc(): boolean {
  const bashrc = path.join(home(), ".bashrc")
  const marker = "# ruth chromebook-lite defaults"
  const line = 'case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac'
  let text = ""
  try {
    text = fs.readFileSync(bashrc, "utf8")
  } catch {
    text = ""
  }
  if (text.includes("$HOME/.local/bin")) return false
  const block = `${text.endsWith("\n") || text === "" ? "" : "\n"}${text.includes(marker) ? "" : `${marker}\n`}${line}\n`
  fs.appendFileSync(bashrc, block)
  return true
}

function ollamaHasModel(name: string): boolean {
  const result = spawnSync("ollama", ["list"], { encoding: "utf8", timeout: 15_000 })
  if (result.status !== 0) return false
  return (result.stdout || "").includes(name) || (result.stdout || "").includes(name.split(":")[0] ?? name)
}

function pullModel(name: string): { ok: boolean; detail: string } {
  const result = spawnSync("ollama", ["pull", name], { encoding: "utf8", timeout: 600_000 })
  if (result.status === 0) return { ok: true, detail: `pulled ${name}` }
  return { ok: false, detail: (result.stderr || result.stdout || `ollama pull ${name} failed`).trim() }
}

function registerPlugin(configPath: string, pluginPath: string): boolean {
  try {
    const raw = fs.readFileSync(configPath, "utf8")
    const json = JSON.parse(raw) as { plugins?: unknown }
    const plugins = Array.isArray(json.plugins) ? [...json.plugins] : []
    const already = plugins.some((entry) => entry === pluginPath || (entry && typeof entry === "object" && (entry as { package?: string }).package === pluginPath))
    if (already) return false
    plugins.push(pluginPath)
    json.plugins = plugins
    fs.writeFileSync(configPath, `${JSON.stringify(json, null, 2)}\n`)
    return true
  } catch {
    return false
  }
}

export function runDoctor(options: { repair?: boolean } = {}): DoctorReport {
  const repair = options.repair !== false
  const checks: DoctorCheck[] = []

  const binDir = path.join(home(), ".local", "bin")
  const inPath = pathHasLocalBin() || process.argv[1]?.startsWith(binDir)
  let pathRepaired = false
  if (!inPath && repair) pathRepaired = ensurePathInBashrc()
  checks.push({
    name: "path",
    ok: inPath || pathRepaired,
    repaired: pathRepaired,
    detail: inPath
      ? "~/.local/bin is on PATH"
      : pathRepaired
        ? "Appended ~/.local/bin to ~/.bashrc — open a new terminal"
        : "~/.local/bin is not on PATH; add it or re-run the installer",
  })

  let configCreated = false
  const plugin = pluginDist()
  const before = findExistingConfig()
  const ensured = repair ? ensureDefaultConfig({ pluginPath: plugin }) : { path: before ?? path.join(configDir(), "ruth.json"), created: false }
  configCreated = ensured.created
  let pluginRepaired = false
  if (repair && plugin && ensured.path) pluginRepaired = registerPlugin(ensured.path, plugin)
  checks.push({
    name: "config",
    ok: fs.existsSync(ensured.path),
    repaired: configCreated,
    detail: configCreated
      ? `Wrote default config ${ensured.path} (Ollama ${DEFAULT_CHAT_MODEL})`
      : ensured.path
        ? `Config ${ensured.path}`
        : "No ruth.json found",
  })

  checks.push({
    name: "plugin",
    ok: Boolean(plugin),
    repaired: pluginRepaired,
    detail: plugin
      ? pluginRepaired
        ? `Registered plugin ${plugin} in config`
        : `Plugin present at ${plugin}`
      : "Oh My OpenCode plugin is not installed. Re-run scripts/install.sh (INSTALL_PLUGIN defaults to 1).",
  })

  const ollama = spawnSync("which", ["ollama"], { encoding: "utf8" })
  const ollamaOk = ollama.status === 0 || Boolean(spawnSync("ollama", ["--version"], { encoding: "utf8" }).stdout)
  let modelRepaired = false
  let modelOk = false
  let modelDetail = "ollama is not installed or not on PATH"
  if (ollamaOk) {
    modelOk = ollamaHasModel(DEFAULT_CHAT_MODEL)
    if (!modelOk && repair) {
      const pulled = pullModel(DEFAULT_CHAT_MODEL)
      modelRepaired = pulled.ok
      modelOk = pulled.ok
      modelDetail = pulled.ok
        ? `Installed ${DEFAULT_CHAT_MODEL}. For tools, also run: ollama pull ${DEFAULT_TOOLS_MODEL}`
        : pulled.detail
    } else {
      modelDetail = modelOk
        ? `ollama has ${DEFAULT_CHAT_MODEL}`
        : `Missing ${DEFAULT_CHAT_MODEL}. Run: ollama pull ${DEFAULT_CHAT_MODEL}`
    }
  }
  checks.push({
    name: "ollama",
    ok: ollamaOk,
    detail: ollamaOk ? "ollama is on PATH" : "Install Ollama (https://ollama.com) so Ruth can chat locally with no cloud keys.",
  })
  checks.push({
    name: "model",
    ok: modelOk,
    repaired: modelRepaired,
    detail: modelDetail,
  })

  let diskOk = true
  let diskDetail = "disk space ok"
  try {
    const result = spawnSync("df", ["-Pk", home()], { encoding: "utf8" })
    const line = (result.stdout || "").trim().split("\n").at(-1) ?? ""
    const parts = line.split(/\s+/)
    const availKiB = Number(parts[3])
    if (Number.isFinite(availKiB)) {
      diskOk = availKiB > 1024 * 1024 // 1 GiB
      diskDetail = `${Math.round(availKiB / 1024)} MiB free under ${home()}`
    }
  } catch {
    diskDetail = "could not read free disk"
  }
  checks.push({ name: "disk", ok: diskOk, detail: diskDetail })

  const watcher = shouldEnableFilewatcher()
  checks.push({
    name: "filewatcher",
    ok: true,
    detail:
      watcher.reason === "low-memory"
        ? `File watcher off until memory is above 768 MiB (MemAvailable ${readMemAvailableKiB() ?? "?"} KiB)`
        : watcher.enabled
          ? "File watcher is on"
          : "File watcher is disabled by RUTH_FILEWATCHER_DISABLE / OPENCODE_FILEWATCHER_DISABLE",
  })
  checks.push({
    name: "memory",
    ok: !isLowMemory(),
    detail: isLowMemory()
      ? `Low memory (MemAvailable under 768 MiB). Background work may be limited.`
      : `Memory ok (MemAvailable ${readMemAvailableKiB() ?? "n/a"} KiB)`,
  })

  const token = resolveGithubToken()
  checks.push({
    name: "github-token",
    ok: Boolean(token),
    detail: token
      ? "GitHub token is available for private releases (not printed)"
      : "No GitHub token. Set GITHUB_TOKEN or write ~/.config/ruth/github-token so `ruth upgrade` / `ruth self-update` can work.",
  })

  const required = new Set(["path", "config", "ollama", "model", "disk", "plugin"])
  return { ok: checks.filter((check) => required.has(check.name)).every((check) => check.ok), checks }
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = report.checks.map((check) => {
    const mark = check.ok ? "ok" : "FAIL"
    const repaired = check.repaired ? " (repaired)" : ""
    return `[${mark}] ${check.name}${repaired}: ${check.detail}`
  })
  lines.push(report.ok ? "\nRuth is ready. Try: ruth run 'hello'" : "\nRuth needs attention. Re-run `ruth doctor` after fixing the FAIL items.")
  return lines.join("\n")
}
