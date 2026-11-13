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
import { ensureRuthModels, ollamaHasModel } from "./ruth-models"
import { shouldEnableFilewatcher } from "./filewatcher-policy"
import { doctorCloudChecks } from "./cloud"
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


function home(): string {
  return env("TEST_HOME") || os.homedir()
}

function pluginDist(): string | undefined {
  const data = env("XDG_DATA_HOME") || path.join(home(), ".local", "share")
  const candidates = [
    path.join(data, "ruth", "plugin"),
    path.join(data, "oh-my-openagent"), // leftover path from earlier installs
  ]
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "dist", "index.js"))) return dir
  }
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
    if (repair) {
      const had = modelOk
      const ensured = ensureRuthModels()
      modelRepaired = ensured.ruth && !had
      modelOk = ensured.ruth
      modelDetail = ensured.detail
    } else {
      const pro = ollamaHasModel(DEFAULT_TOOLS_MODEL)
      modelDetail = modelOk
        ? (pro
            ? "ollama has ruth and ruth-pro"
            : "ollama has ruth. For heavier tools: ruth doctor --repair (builds ruth-pro on 4b)")
        : "Missing Ollama model `ruth`. Run: ruth doctor --repair"
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

  checks.push(...doctorCloudChecks())

  const token = resolveGithubToken()
  checks.push({
    name: "github-token",
    ok: true,
    detail: token
      ? "GitHub token is available (optional; public the3kingleo-cmyk/ruth-install releases do not need one)"
      : "No GitHub token; that is fine. `ruth upgrade` / `ruth self-update` use the public the3kingleo-cmyk/ruth-install releases.",
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
