import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parse } from "jsonc-parser"

export type Roots = {
  readonly data: string
  readonly config: string
  readonly state: string
  readonly home?: string
}

function stamp(now = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
}

/** Rename a path to a sibling `*.bak-<timestamp>` if it exists. */
export function quarantinePath(target: string, timestamp = stamp()): string | undefined {
  if (!fs.existsSync(target)) return undefined
  let dest = `${target}.bak-${timestamp}`
  if (fs.existsSync(dest)) dest = `${dest}-${process.pid}`
  fs.renameSync(target, dest)
  return dest
}

/** Move leftover Ruth data, config, and state aside so boot can start fresh. */
export function quarantineRuthState(roots: Roots, timestamp = stamp()): string[] {
  const moved: string[] = []
  for (const target of [roots.data, roots.config, roots.state]) {
    const dest = quarantinePath(target, timestamp)
    if (dest) moved.push(dest)
  }
  const home = roots.home ?? os.homedir()
  if (home) {
    const dest = quarantinePath(path.join(home, ".ruth.json"), timestamp)
    if (dest) moved.push(dest)
  }
  return moved
}

export function ensureRootDirs(roots: Roots) {
  for (const dir of [roots.data, roots.config, roots.state]) {
    if (dir) fs.mkdirSync(dir, { recursive: true })
  }
  if (roots.data) {
    fs.mkdirSync(path.join(roots.data, "log"), { recursive: true })
    fs.mkdirSync(path.join(roots.data, "repos"), { recursive: true })
  }
}

function isUnusableDatabase(dbPath: string): boolean {
  if (!fs.existsSync(dbPath)) return false
  let st: fs.Stats
  try {
    st = fs.lstatSync(dbPath)
  } catch {
    return true
  }
  if (!st.isFile()) return true
  if (st.size === 0) return false
  try {
    const fd = fs.openSync(dbPath, "r")
    try {
      const buf = Buffer.alloc(16)
      const n = fs.readSync(fd, buf, 0, 16, 0)
      if (n < 16) return true
      return buf.toString("utf8") !== "SQLite format 3\u0000"
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return true
  }
}

function isUnusableConfig(configDir: string): boolean {
  if (fs.existsSync(path.join(configDir, ".ruth.json"))) return true
  const file = ["ruth.json", "ruth.jsonc"].map((name) => path.join(configDir, name)).find((p) => fs.existsSync(p))
  if (!file) return false
  try {
    const text = fs.readFileSync(file, "utf8")
    const errors: { message?: string }[] = []
    const parsed = parse(text, errors)
    if (errors.length > 0) return true
    return parsed === undefined || (parsed !== null && typeof parsed !== "object")
  } catch {
    return true
  }
}

/** Why leftover data or config would break boot, or undefined when it looks usable. */
export function needsQuarantine(roots: Roots, dbPath: string): string | undefined {
  if (isUnusableDatabase(dbPath)) return "unusable database"
  if (isUnusableConfig(roots.config)) return "unusable or leftover config"
  return undefined
}

/** If leftovers would prevent boot, move them aside and recreate the directories. */
export function recoverIfNeeded(roots: Roots, dbPath: string): string[] {
  if (!needsQuarantine(roots, dbPath)) return []
  const moved = quarantineRuthState(roots)
  ensureRootDirs(roots)
  return moved
}

export function isDataBootFailure(error: unknown): boolean {
  const parts: string[] = []
  const walk = (value: unknown, depth = 0) => {
    if (value == null || depth > 6) return
    if (typeof value === "string") {
      parts.push(value)
      return
    }
    if (value instanceof Error) {
      parts.push(value.name, value.message, value.stack ?? "")
      walk((value as Error & { cause?: unknown }).cause, depth + 1)
      return
    }
    if (typeof value === "object") {
      for (const key of ["message", "reason", "_tag", "code"] as const) {
        if (key in value) walk((value as Record<string, unknown>)[key], depth + 1)
      }
      if ("cause" in value) walk((value as { cause?: unknown }).cause, depth + 1)
    }
  }
  walk(error)
  const text = parts.join("\n")
  return /unable to open database|Failed to open database|SQLITE_CANTOPEN|SQLITE_CORRUPT|SQLITE_NOTADB|not a database|Failed to parse|Invalid config|migration failed|database is locked/i.test(
    text,
  )
}

/** After a boot crash that looks like bad data or config, move leftovers aside. */
export function recoverAfterBootFailure(roots: Roots, error: unknown): string[] | undefined {
  if (!isDataBootFailure(error)) return undefined
  const moved = quarantineRuthState(roots)
  ensureRootDirs(roots)
  return moved
}
