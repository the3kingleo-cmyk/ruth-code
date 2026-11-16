import { spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { env } from "@opencode/util/env"

export const DEFAULT_GITHUB_OWNER = "the3kingleo-cmyk"

export function projectsDir(): string {
  const home = env("TEST_HOME") || os.homedir()
  return env("PROJECTS_DIR") || path.join(home, "src")
}

export function homeDir(): string {
  return env("TEST_HOME") || os.homedir()
}

/** True when the current working directory is the user's home (including "~"). */
export function isHomeDirectory(dir = process.cwd()): boolean {
  const home = path.resolve(homeDir())
  let resolved = dir
  try {
    resolved = fs.realpathSync(path.resolve(dir === "~" ? home : dir))
  } catch {
    resolved = path.resolve(dir === "~" ? home : dir)
  }
  let homeReal = home
  try {
    homeReal = fs.realpathSync(home)
  } catch {
    // keep home
  }
  return resolved === homeReal
}

export type LaunchDirectory = {
  directory: string
  cloned: boolean
  detail: string
}

/**
 * Resolve the directory the TUI / `run` should start in.
 *
 * - No argument, launched from ~ (or an equivalent home path): $HOME
 * - An existing local path (or ~): that path
 * - A repo name (`ruth-code`) or `owner/repo`: clone on demand into ~/src/owner/repo
 */
export function resolveLaunchDirectory(
  requested: string | undefined,
  options: {
    cwd?: string
    clone?: (spec: { owner: string; repo: string; dest: string }) => void
  } = {},
): LaunchDirectory {
  const cwd = options.cwd ?? process.cwd()
  const home = homeDir()
  if (!requested || requested === "." || requested === "~") {
    const directory = !requested || isHomeDirectory(cwd) || requested === "~" ? home : path.resolve(cwd)
    return { directory, cloned: false, detail: directory }
  }
  const expanded = requested.startsWith("~/") ? path.join(home, requested.slice(2)) : requested
  if (fs.existsSync(expanded) && fs.statSync(expanded).isDirectory()) {
    return { directory: path.resolve(expanded), cloned: false, detail: path.resolve(expanded) }
  }
  const parsed = parseRepoSpec(requested)
  if (!parsed) {
    return { directory: path.resolve(expanded), cloned: false, detail: path.resolve(expanded) }
  }
  const dest = path.join(projectsDir(), parsed.owner, parsed.repo)
  if (fs.existsSync(path.join(dest, ".git")) || fs.existsSync(dest)) {
    return { directory: dest, cloned: false, detail: dest }
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const clone = options.clone ?? defaultClone
  clone({ ...parsed, dest })
  return { directory: dest, cloned: true, detail: `cloned ${parsed.owner}/${parsed.repo} to ${dest}` }
}

export function parseRepoSpec(raw: string): { owner: string; repo: string } | undefined {
  const trimmed = raw.trim().replace(/\/+$/, "")
  if (!trimmed || trimmed.startsWith(".") || trimmed.startsWith("/")) return undefined
  if (trimmed.includes("\\") || trimmed.includes("..")) return undefined
  const github = trimmed.match(/^(?:https?:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?$/i)
  if (github) return { owner: github[1], repo: github[2] }
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    const [owner, repo] = trimmed.split("/")
    return { owner, repo }
  }
  if (/^[A-Za-z0-9_.-]+$/.test(trimmed)) return { owner: DEFAULT_GITHUB_OWNER, repo: trimmed }
  return undefined
}

function defaultClone(spec: { owner: string; repo: string; dest: string }) {
  const result = spawnSync("gh", ["repo", "clone", `${spec.owner}/${spec.repo}`, spec.dest], {
    encoding: "utf8",
    timeout: 300_000,
  })
  if (result.status === 0) return
  const fallback = spawnSync(
    "git",
    ["clone", `https://github.com/${spec.owner}/${spec.repo}.git`, spec.dest],
    { encoding: "utf8", timeout: 300_000 },
  )
  if (fallback.status !== 0) {
    throw new Error(
      (result.stderr || fallback.stderr || `could not clone ${spec.owner}/${spec.repo}`).trim(),
    )
  }
}
