import { spawn, spawnSync, type ChildProcess } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import {
  CLOUD_REMOTE_PORT,
  DEFAULT_CLOUD_LOCAL_PORT,
  LOCAL_OLLAMA_ORIGIN,
  type CloudState,
  clearCloudState,
  cloudOriginFromState,
  cloudStatePath,
  probeOllama,
  readCloudState,
  resolveOllamaOrigin,
  writeCloudState,
} from "@opencode/util/ollama-origin"
import { env } from "@opencode/util/env"
import { resolveGithubToken } from "./github-release"

export const DEFAULT_CLOUD_REPO = "the3kingleo-cmyk/ruth-codespace"
export const DEFAULT_CLOUD_MACHINE = "standardLinux32gb"
export const DEFAULT_CLOUD_DISPLAY_NAME = "ruth-ollama"
/** Personal accounts typically cap idle timeout at 4 hours. */
export const DEFAULT_IDLE_TIMEOUT = "240m"
/** Keep the stopped codespace (and pulled models) for 30 days. */
export const DEFAULT_RETENTION = "720h"
/** 120 core-hours / 4 cores on standardLinux32gb. */
export const FREE_CORE_HOURS_PER_MONTH = 120
export const STANDARD_MACHINE_CPUS = 4

export type GhResult = { status: number; stdout: string; stderr: string }

export type GhRunner = (args: string[], options?: { timeoutMs?: number; env?: NodeJS.ProcessEnv }) => GhResult

export type CloudOptions = {
  repo?: string
  machine?: string
  displayName?: string
  localPort?: number
  remotePort?: number
  idleTimeout?: string
  retention?: string
  gh?: GhRunner
  spawnForward?: (args: ForwardSpawnArgs) => { pid: number }
  wait?: (ms: number) => void
  now?: () => Date
  probe?: (origin: string) => boolean
  log?: (message: string) => void
}

export type ForwardSpawnArgs = {
  codespace: string
  localPort: number
  remotePort: number
  logFile: string
  env: NodeJS.ProcessEnv
}

export type CloudUpResult = {
  ok: boolean
  created: boolean
  reused: boolean
  name: string
  origin: string
  detail: string
}

export type CloudStatus = {
  ghInstalled: boolean
  auth: { ok: boolean; detail: string; missingScope: boolean }
  codespace?: {
    name: string
    state: string
    repo?: string
    machine?: string
    cpus?: number
    lastUsedAt?: string
    displayName?: string
  }
  tunnel: { ok: boolean; pid?: number; localPort?: number; detail: string }
  origin: string
  preferred: "cloud" | "local" | "pinned"
  hours?: { sessionHours?: number; sessionCoreHours?: number; note: string }
  detail: string
}

const AVAILABLE_STATES = new Set(["Available", "available"])
const STARTING_STATES = new Set([
  "Queued",
  "Provisioning",
  "Starting",
  "Updating",
  "Rebuilding",
  "Moved",
  "Updated",
  "Awaiting",
  "Shutdown",
  "ShuttingDown",
])

export function missingGhMessage(): string {
  return "The GitHub CLI (gh) is not installed. Install it with: sudo apt-get update && sudo apt-get install -y gh   (or see https://cli.github.com/ )"
}

export function missingScopeMessage(): string {
  return [
    "This GitHub token cannot manage Codespaces.",
    "If it is a classic personal access token, add the `codespace` scope (and `repo`), then re-authenticate.",
    "If it is a fine-grained token, grant Codespaces Read and Write on the3kingleo-cmyk/ruth-codespace,",
    "plus any account-level Codespaces permission shown in the token settings.",
    "You can also run: gh auth login",
    "or: gh auth refresh -h github.com -s codespace,repo",
  ].join(" ")
}

export function isScopeError(output: string, status?: number): boolean {
  const text = output.toLowerCase()
  if (
    text.includes("codespace") &&
    (text.includes("scope") ||
      text.includes("resource not accessible by personal access token") ||
      text.includes("requires authentication") ||
      text.includes("permission"))
  ) {
    return true
  }
  if (status === 401 || status === 403) {
    if (
      text.includes("resource not accessible") ||
      text.includes("bad credentials") ||
      text.includes("must have") ||
      text.includes("forbidden") ||
      text.includes("codespace")
    ) {
      return true
    }
  }
  return false
}

export function defaultGhRunner(args: string[], options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): GhResult {
  const envVars = { ...process.env, ...githubEnv(), ...(options.env ?? {}) }
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    timeout: options.timeoutMs ?? 120_000,
    env: envVars,
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  }
}

function githubEnv(): NodeJS.ProcessEnv {
  const token = resolveGithubToken()
  const extra: NodeJS.ProcessEnv = {}
  if (token) {
    extra.GITHUB_TOKEN = token
    extra.GH_TOKEN = token
  }
  return extra
}

export function ghInstalled(): boolean {
  const result = spawnSync("gh", ["--version"], { encoding: "utf8", timeout: 5_000 })
  return result.status === 0
}

export function estimateSessionHours(startedAt: string | undefined, now = new Date(), cpus = STANDARD_MACHINE_CPUS): {
  sessionHours: number
  sessionCoreHours: number
  note: string
} {
  let sessionHours = 0
  if (startedAt) {
    const then = new Date(startedAt)
    if (!Number.isNaN(then.getTime())) {
      sessionHours = Math.max(0, (now.getTime() - then.getTime()) / 3_600_000)
    }
  }
  const sessionCoreHours = sessionHours * cpus
  const monthHoursOnStandard = FREE_CORE_HOURS_PER_MONTH / cpus
  const note =
    `GitHub personal accounts include about ${FREE_CORE_HOURS_PER_MONTH} core-hours per month. ` +
    `A ${cpus}-core machine uses that as roughly ${monthHoursOnStandard} clock hours. ` +
    `Stop the codespace with \`ruth cloud down\` when you are done. ` +
    `This is an estimate of the current session only; GitHub does not always expose remaining monthly hours through the API. ` +
    `Check https://github.com/settings/billing for the exact remaining allowance.`
  return {
    sessionHours: Math.round(sessionHours * 100) / 100,
    sessionCoreHours: Math.round(sessionCoreHours * 100) / 100,
    note,
  }
}

function logLine(options: CloudOptions, message: string) {
  ;(options.log ?? console.log)(message)
}

function wait(options: CloudOptions, ms: number) {
  if (options.wait) options.wait(ms)
  else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export function parseCodespaceList(stdout: string): Array<{
  name: string
  state: string
  displayName?: string
  repository?: string
  machineName?: string
  lastUsedAt?: string
  createdAt?: string
}> {
  try {
    const json = JSON.parse(stdout)
    return Array.isArray(json) ? json : []
  } catch {
    return []
  }
}

export function pickExistingCodespace(
  list: ReturnType<typeof parseCodespaceList>,
  options: { repo: string; displayName: string },
) {
  const wanted = list.filter((item) => {
    const repo = item.repository ?? ""
    return repo === options.repo || repo.endsWith(`/${options.repo.split("/")[1]}`) || !item.repository
  })
  const named = wanted.filter((item) => (item.displayName || "").toLowerCase() === options.displayName.toLowerCase())
  const pool = named.length > 0 ? named : wanted
  const running = pool.find((item) => AVAILABLE_STATES.has(item.state))
  return running ?? pool[0]
}

function runGh(options: CloudOptions, args: string[], timeoutMs?: number): GhResult {
  const runner = options.gh ?? defaultGhRunner
  return runner(args, { timeoutMs })
}

function checkAuth(options: CloudOptions): { ok: boolean; detail: string; missingScope: boolean } {
  if (!ghInstalled() && !options.gh) {
    return { ok: false, detail: missingGhMessage(), missingScope: false }
  }
  const result = runGh(options, ["api", "user/codespaces", "--jq", ".total_count"])
  const output = `${result.stdout}\n${result.stderr}`
  if (result.status === 0) return { ok: true, detail: "GitHub CLI can list Codespaces", missingScope: false }
  if (isScopeError(output, result.status)) {
    return { ok: false, detail: missingScopeMessage(), missingScope: true }
  }
  return {
    ok: false,
    detail: (result.stderr || result.stdout || "gh api user/codespaces failed").trim() || missingScopeMessage(),
    missingScope: isScopeError(output, result.status),
  }
}

function listCodespaces(options: CloudOptions, repo: string) {
  const result = runGh(options, [
    "codespace",
    "list",
    "--repo",
    repo,
    "--json",
    "name,state,displayName,repository,machineName,lastUsedAt,createdAt",
  ])
  if (result.status !== 0) {
    const output = `${result.stdout}\n${result.stderr}`
    if (isScopeError(output, result.status)) throw new Error(missingScopeMessage())
    throw new Error((result.stderr || result.stdout || "gh codespace list failed").trim())
  }
  return parseCodespaceList(result.stdout)
}

function viewCodespace(options: CloudOptions, name: string): { state: string; raw: string } {
  const result = runGh(options, [
    "codespace",
    "view",
    "--codespace",
    name,
    "--json",
    "name,state,displayName,machineName,lastUsedAt,repository",
  ])
  if (result.status !== 0) return { state: "Unknown", raw: result.stderr || result.stdout }
  try {
    const json = JSON.parse(result.stdout) as { state?: string }
    return { state: json.state ?? "Unknown", raw: result.stdout }
  } catch {
    return { state: "Unknown", raw: result.stdout }
  }
}

function startCodespace(options: CloudOptions, name: string) {
  // gh has no `start` subcommand; the REST API starts a stopped codespace.
  const result = runGh(options, ["api", "-X", "POST", `/user/codespaces/${encodeURIComponent(name)}/start`], 180_000)
  if (result.status !== 0) {
    const output = `${result.stdout}\n${result.stderr}`
    // Starting an already-available codespace can 409; treat that as success.
    if (output.includes("409") || output.toLowerCase().includes("already")) return
    if (isScopeError(output, result.status)) throw new Error(missingScopeMessage())
    throw new Error((result.stderr || result.stdout || `failed to start ${name}`).trim())
  }
}

function createCodespace(options: CloudOptions, repo: string): string {
  const args = [
    "codespace",
    "create",
    "--repo",
    repo,
    "--machine",
    options.machine ?? DEFAULT_CLOUD_MACHINE,
    "--idle-timeout",
    options.idleTimeout ?? DEFAULT_IDLE_TIMEOUT,
    "--retention-period",
    options.retention ?? DEFAULT_RETENTION,
    "--display-name",
    options.displayName ?? DEFAULT_CLOUD_DISPLAY_NAME,
    "--default-permissions",
  ]
  logLine(options, `Creating codespace on ${repo} (${options.machine ?? DEFAULT_CLOUD_MACHINE}, idle ${options.idleTimeout ?? DEFAULT_IDLE_TIMEOUT}) ...`)
  const result = runGh(options, args, 600_000)
  if (result.status !== 0) {
    const output = `${result.stdout}\n${result.stderr}`
    if (isScopeError(output, result.status)) throw new Error(missingScopeMessage())
    throw new Error((result.stderr || result.stdout || "gh codespace create failed").trim())
  }
  const name = result.stdout.trim().split(/\s+/).at(-1) || result.stdout.trim()
  if (!name) throw new Error("gh codespace create did not print a codespace name")
  return name
}

function waitUntilAvailable(options: CloudOptions, name: string, timeoutMs = 15 * 60_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const view = viewCodespace(options, name)
    if (AVAILABLE_STATES.has(view.state)) return view
    if (view.state === "Failed" || view.state === "Unavailable") {
      throw new Error(`Codespace ${name} entered state ${view.state}`)
    }
    logLine(options, `Waiting for codespace ${name} (${view.state || "unknown"}) ...`)
    wait(options, 8_000)
  }
  throw new Error(`Timed out waiting for codespace ${name} to become Available`)
}

function waitForRemoteOllama(options: CloudOptions, name: string, timeoutMs = 20 * 60_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const result = runGh(
      options,
      ["codespace", "ssh", "--codespace", name, "--", "curl", "-sf", "--max-time", "5", "http://127.0.0.1:11434/api/tags"],
      30_000,
    )
    if (result.status === 0 && (result.stdout.includes("models") || result.stdout.includes("{"))) return
    logLine(options, "Waiting for Ollama inside the codespace to become healthy (models may still be pulling) ...")
    wait(options, 10_000)
  }
  throw new Error("Timed out waiting for Ollama on the codespace (port 11434). See: ruth cloud logs")
}

export function forwardLogPath(): string {
  return path.join(path.dirname(cloudStatePath()), "cloud-forward.log")
}

export function pidIsAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function stopForwarder(state: CloudState | undefined = readCloudState()): boolean {
  const pid = state?.pid
  if (!pidIsAlive(pid)) return false
  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      return false
    }
  }
  return true
}

function defaultSpawnForward(args: ForwardSpawnArgs): { pid: number } {
  const binary = process.argv[1] && fs.existsSync(process.argv[1]) ? process.argv[0] : process.argv[0]
  // When running a compiled `ruth` binary, argv[0] is the binary and argv[1] may be "cloud".
  const compiled = path.basename(process.execPath) === "ruth" || path.basename(process.argv[0]) === "ruth"
  const command = compiled ? process.argv[0] : process.execPath
  const prefix = compiled ? [] : [process.argv[1] ?? process.argv[0]]
  const child = spawn(
    command,
    [...prefix, "cloud", "forward", "--codespace", args.codespace, "--local-port", String(args.localPort), "--remote-port", String(args.remotePort)],
    {
      detached: true,
      stdio: ["ignore", fs.openSync(args.logFile, "a"), fs.openSync(args.logFile, "a")],
      env: args.env,
    },
  )
  child.unref()
  if (!child.pid) throw new Error("failed to start the port-forward supervisor")
  return { pid: child.pid }
}

function startForwarder(options: CloudOptions, name: string, localPort: number, remotePort: number): { pid: number; logFile: string } {
  const logFile = forwardLogPath()
  fs.mkdirSync(path.dirname(logFile), { recursive: true })
  const existing = readCloudState()
  if (existing?.pid && pidIsAlive(existing.pid) && existing.name === name && existing.localPort === localPort) {
    return { pid: existing.pid, logFile: existing.logFile ?? logFile }
  }
  if (existing?.pid && pidIsAlive(existing.pid)) stopForwarder(existing)
  const spawnForward = options.spawnForward ?? defaultSpawnForward
  const started = spawnForward({
    codespace: name,
    localPort,
    remotePort,
    logFile,
    env: { ...process.env, ...githubEnv() },
  })
  return { pid: started.pid, logFile }
}

export function runForwardLoop(options: {
  codespace: string
  localPort: number
  remotePort: number
  gh?: GhRunner
  spawn?: (args: string[], env: NodeJS.ProcessEnv) => { wait: () => number; kill: () => void }
  shouldContinue?: () => boolean
  wait?: (ms: number) => void
  log?: (message: string) => void
}): void {
  const run =
    options.spawn ??
    ((args, envVars) => {
      const child: ChildProcess = spawn("gh", args, { env: envVars, stdio: "inherit" })
      return {
        wait: () => {
          return new Promise<number>((resolve) => {
            child.on("exit", (code) => resolve(code ?? 1))
          }) as unknown as number
        },
        kill: () => {
          if (child.pid) {
            try {
              child.kill("SIGTERM")
            } catch {
              // already gone
            }
          }
        },
      }
    })
  const envVars = { ...process.env, ...githubEnv() }
  const args = [
    "codespace",
    "ports",
    "forward",
    `${options.remotePort}:${options.localPort}`,
    "--codespace",
    options.codespace,
  ]
  const stop = () => !options.shouldContinue || options.shouldContinue()
  const onStop = () => {
    /* placeholder for type narrowing */
  }
  void onStop
  process.on("SIGTERM", () => process.exit(0))
  process.on("SIGINT", () => process.exit(0))
  while (stop()) {
    ;(options.log ?? console.error)(
      `Forwarding codespace ${options.codespace} ${options.remotePort} -> 127.0.0.1:${options.localPort}`,
    )
    const child = run(args, envVars)
    const code = child.wait()
    // If wait returned a Promise (live supervisor), the caller is the CLI handler which is async... 
    // For the compiled binary handler we use a blocking spawnSync loop instead. See runForwardLoopSync.
    if (typeof code === "number" && code === 0) {
      // Clean exit; still reconnect unless we were asked to stop.
    }
    if (options.shouldContinue && !options.shouldContinue()) break
    if (options.wait) options.wait(2_000)
    else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2_000)
  }
}

/** Blocking auto-reconnect loop used by `ruth cloud forward`. */
export function runForwardLoopSync(options: { codespace: string; localPort: number; remotePort: number }): void {
  const envVars = { ...process.env, ...githubEnv() }
  const args = ["codespace", "ports", "forward", `${options.remotePort}:${options.localPort}`, "--codespace", options.codespace]
  let stopping = false
  const halt = () => {
    stopping = true
  }
  process.on("SIGTERM", halt)
  process.on("SIGINT", halt)
  while (!stopping) {
    process.stderr.write(
      `Forwarding codespace ${options.codespace} ${options.remotePort} -> 127.0.0.1:${options.localPort}\n`,
    )
    const result = spawnSync("gh", args, { env: envVars, stdio: "inherit" })
    if (stopping) break
    const status = result.status ?? 1
    process.stderr.write(`port-forward exited (${status}); reconnecting in 2s\n`)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2_000)
  }
}

export async function cloudUp(options: CloudOptions = {}): Promise<CloudUpResult> {
  const repo = options.repo ?? env("CLOUD_REPO") ?? DEFAULT_CLOUD_REPO
  const displayName = options.displayName ?? DEFAULT_CLOUD_DISPLAY_NAME
  const localPort = options.localPort ?? Number(env("CLOUD_LOCAL_PORT") ?? DEFAULT_CLOUD_LOCAL_PORT)
  const remotePort = options.remotePort ?? CLOUD_REMOTE_PORT

  if (!ghInstalled() && !options.gh) {
    return { ok: false, created: false, reused: false, name: "", origin: LOCAL_OLLAMA_ORIGIN, detail: missingGhMessage() }
  }

  const auth = checkAuth(options)
  if (!auth.ok) {
    return { ok: false, created: false, reused: false, name: "", origin: LOCAL_OLLAMA_ORIGIN, detail: auth.detail }
  }

  let created = false
  const existing = pickExistingCodespace(listCodespaces(options, repo), { repo, displayName })
  let name = existing?.name
  if (!name) {
    name = createCodespace(options, repo)
    created = true
  } else {
    logLine(options, `Reusing codespace ${name} (${existing?.state ?? "unknown"})`)
    if (!AVAILABLE_STATES.has(existing?.state ?? "")) {
      logLine(options, `Starting codespace ${name} ...`)
      startCodespace(options, name)
    }
  }

  waitUntilAvailable(options, name)
  waitForRemoteOllama(options, name)

  const forward = startForwarder(options, name, localPort, remotePort)
  const origin = `http://127.0.0.1:${localPort}`
  const probe = options.probe ?? ((url) => probeOllama(url, 2_000))
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline && !probe(origin)) {
    logLine(options, `Waiting for local tunnel on ${origin} ...`)
    wait(options, 2_000)
  }
  if (!probe(origin) && !options.probe) {
    return {
      ok: false,
      created,
      reused: !created,
      name,
      origin: LOCAL_OLLAMA_ORIGIN,
      detail: `Codespace ${name} is up but the local tunnel on ${origin} is not healthy yet. See ${forward.logFile} or run: ruth cloud logs`,
    }
  }

  writeCloudState({
    repo,
    name,
    displayName,
    machine: options.machine ?? DEFAULT_CLOUD_MACHINE,
    localPort,
    remotePort,
    pid: forward.pid,
    logFile: forward.logFile,
    startedAt: (options.now ?? (() => new Date()))().toISOString(),
    cpus: STANDARD_MACHINE_CPUS,
  })

  const detail = `Codespace ${name} is Available. Ollama is tunneled to ${origin} (local Ollama on ${LOCAL_OLLAMA_ORIGIN} is left alone; Ruth falls back to it if this tunnel drops). Stop with: ruth cloud down`
  logLine(options, detail)
  return { ok: true, created, reused: !created, name, origin, detail }
}

export function cloudDown(options: CloudOptions = {}): { ok: boolean; detail: string } {
  const state = readCloudState()
  const repo = options.repo ?? state?.repo ?? env("CLOUD_REPO") ?? DEFAULT_CLOUD_REPO
  const displayName = options.displayName ?? state?.displayName ?? DEFAULT_CLOUD_DISPLAY_NAME
  const stoppedForward = stopForwarder(state)
  let name = state?.name
  if (!name && (ghInstalled() || options.gh)) {
    try {
      name = pickExistingCodespace(listCodespaces(options, repo), { repo, displayName })?.name
    } catch {
      // listing can fail if scopes are missing; still clear local state
    }
  }
  let stoppedSpace = false
  let message = ""
  if (name && (ghInstalled() || options.gh)) {
    const result = runGh(options, ["codespace", "stop", "--codespace", name], 180_000)
    if (result.status === 0) {
      stoppedSpace = true
      message = `Stopped codespace ${name} to save free hours.`
    } else {
      const output = `${result.stdout}\n${result.stderr}`
      if (isScopeError(output, result.status)) message = missingScopeMessage()
      else message = (result.stderr || result.stdout || `failed to stop ${name}`).trim()
    }
  } else if (!name) {
    message = "No Ruth codespace is recorded locally and none were found to stop."
  }
  clearCloudState()
  const bits = [
    stoppedForward ? "Stopped the local port-forward." : undefined,
    message,
    "Ruth will use local Ollama on " + LOCAL_OLLAMA_ORIGIN + " if it is running.",
  ].filter(Boolean)
  return { ok: stoppedSpace || (!name && stoppedForward) || stoppedSpace, detail: bits.join(" ") }
}

export function cloudStatus(options: CloudOptions = {}): CloudStatus {
  const state = readCloudState()
  const probe = options.probe ?? ((origin) => probeOllama(origin, 1_000))
  const origin = resolveOllamaOrigin({ probe, state })
  const preferred: CloudStatus["preferred"] = env("OLLAMA_ORIGIN")
    ? "pinned"
    : origin !== LOCAL_OLLAMA_ORIGIN
      ? "cloud"
      : "local"

  const installed = ghInstalled() || Boolean(options.gh)
  const auth = installed
    ? checkAuth(options)
    : { ok: false, detail: missingGhMessage(), missingScope: false }

  let codespace: CloudStatus["codespace"]
  const repo = options.repo ?? state?.repo ?? DEFAULT_CLOUD_REPO
  if (auth.ok) {
    try {
      const existing =
        (state?.name
          ? { name: state.name, state: viewCodespace(options, state.name).state, displayName: state.displayName, repository: state.repo, machineName: state.machine }
          : undefined) ?? pickExistingCodespace(listCodespaces(options, repo), { repo, displayName: state?.displayName ?? DEFAULT_CLOUD_DISPLAY_NAME })
      if (existing?.name) {
        const view = viewCodespace(options, existing.name)
        let parsed: { state?: string; lastUsedAt?: string; machineName?: string; displayName?: string; repository?: { full_name?: string } | string } = { state: view.state }
        try {
          parsed = { ...JSON.parse(view.raw), state: view.state }
        } catch {
          // keep the state we already have
        }
        const repoName = typeof parsed.repository === "string" ? parsed.repository : parsed.repository?.full_name
        codespace = {
          name: existing.name,
          state: parsed.state ?? existing.state ?? "Unknown",
          repo: repoName ?? state?.repo,
          machine: parsed.machineName ?? existing.machineName ?? state?.machine,
          cpus: state?.cpus ?? STANDARD_MACHINE_CPUS,
          lastUsedAt: parsed.lastUsedAt,
          displayName: parsed.displayName ?? existing.displayName,
        }
      }
    } catch (error) {
      // surface via detail later
      if (!auth.detail) auth.detail = error instanceof Error ? error.message : String(error)
    }
  }

  const tunnelOk = Boolean(state && probe(cloudOriginFromState(state)))
  const tunnel: CloudStatus["tunnel"] = {
    ok: tunnelOk,
    pid: state?.pid,
    localPort: state?.localPort,
    detail: tunnelOk
      ? `Tunnel is healthy on ${cloudOriginFromState(state!)} (pid ${state?.pid ?? "n/a"})`
      : state
        ? `Tunnel is down${pidIsAlive(state.pid) ? " (supervisor still running)" : " (no supervisor)"}. Ruth will use ${LOCAL_OLLAMA_ORIGIN} until \`ruth cloud up\` succeeds.`
        : "No cloud tunnel is recorded. Run: ruth cloud up",
  }

  const hours =
    codespace && (AVAILABLE_STATES.has(codespace.state) || state?.startedAt)
      ? estimateSessionHours(state?.startedAt ?? codespace.lastUsedAt, options.now?.() ?? new Date(), codespace.cpus ?? STANDARD_MACHINE_CPUS)
      : estimateSessionHours(undefined, options.now?.() ?? new Date())

  const detail = [
    auth.ok ? "Codespaces auth is ok." : auth.detail,
    codespace ? `Codespace ${codespace.name} is ${codespace.state}.` : "No Ruth codespace was found.",
    tunnel.detail,
    `Ruth will talk to ${origin} (${preferred}).`,
  ].join(" ")

  return {
    ghInstalled: installed,
    auth,
    codespace,
    tunnel,
    origin,
    preferred,
    hours,
    detail,
  }
}

export function formatCloudStatus(status: CloudStatus): string {
  const lines = [
    `gh: ${status.ghInstalled ? "installed" : "missing"}`,
    `auth: ${status.auth.ok ? "ok" : "FAIL"} — ${status.auth.detail}`,
    status.codespace
      ? `codespace: ${status.codespace.name} (${status.codespace.state}${status.codespace.machine ? `, ${status.codespace.machine}` : ""})`
      : "codespace: none",
    `tunnel: ${status.tunnel.ok ? "ok" : "down"} — ${status.tunnel.detail}`,
    `origin: ${status.origin} (${status.preferred})`,
  ]
  if (status.hours) {
    if (status.hours.sessionHours) {
      lines.push(
        `session use (estimate): ${status.hours.sessionHours} clock hours, ${status.hours.sessionCoreHours} core-hours`,
      )
    }
    lines.push(status.hours.note)
  }
  return lines.join("\n")
}

export function cloudLogs(options: CloudOptions & { lines?: number } = {}): { ok: boolean; detail: string } {
  const state = readCloudState()
  const localLog = state?.logFile && fs.existsSync(state.logFile) ? fs.readFileSync(state.logFile, "utf8") : ""
  const tail = (text: string, n: number) => text.split(/\r?\n/).slice(-n).join("\n")
  const chunks: string[] = []
  if (localLog) chunks.push(`--- local port-forward log ---\n${tail(localLog, options.lines ?? 80)}`)
  const name = state?.name
  if (name && (ghInstalled() || options.gh)) {
    const result = runGh(options, ["codespace", "logs", "--codespace", name], 60_000)
    if (result.status === 0) chunks.push(`--- codespace ${name} ---\n${tail(result.stdout, options.lines ?? 80)}`)
    else chunks.push(`--- codespace logs ---\n${(result.stderr || result.stdout).trim()}`)
  }
  if (chunks.length === 0) {
    return { ok: false, detail: "No cloud logs yet. Run: ruth cloud up" }
  }
  return { ok: true, detail: chunks.join("\n\n") }
}

export function doctorCloudChecks(): Array<{ name: string; ok: boolean; detail: string }> {
  const status = cloudStatus()
  return [
    {
      name: "cloud-gh",
      ok: status.ghInstalled,
      detail: status.ghInstalled ? "GitHub CLI (gh) is on PATH" : missingGhMessage(),
    },
    {
      name: "cloud-auth",
      ok: status.auth.ok,
      detail: status.auth.detail,
    },
    {
      name: "cloud",
      ok: true, // optional: Ruth still works locally
      detail: status.tunnel.ok
        ? `Cloud Ollama is healthy at ${status.origin}`
        : status.codespace
          ? `Codespace ${status.codespace.name} is ${status.codespace.state}; tunnel is ${status.tunnel.ok ? "up" : "down"}. Local fallback: ${LOCAL_OLLAMA_ORIGIN}. Start with: ruth cloud up`
          : `No cloud tunnel. Ruth uses ${status.origin}. Optional: ruth cloud up (stop with ruth cloud down to save the ~30 hours/month on a 4-core machine).`,
    },
  ]
}

export { LOCAL_OLLAMA_ORIGIN, resolveOllamaOrigin, readCloudState, cloudStatePath }
