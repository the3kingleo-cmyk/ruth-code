import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  isDataBootFailure,
  needsQuarantine,
  recoverAfterBootFailure,
  recoverIfNeeded,
} from "../src/boot-recovery"

function roots() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ruth-boot-recovery-"))
  return {
    home,
    data: path.join(home, ".local", "share", "ruth"),
    config: path.join(home, ".config", "ruth"),
    state: path.join(home, ".local", "state", "ruth"),
  }
}

function cleanup(home: string) {
  fs.rmSync(home, { recursive: true, force: true })
}

test("leaves a healthy sqlite database and config in place", () => {
  const r = roots()
  try {
    fs.mkdirSync(r.data, { recursive: true })
    fs.mkdirSync(r.config, { recursive: true })
    const db = path.join(r.data, "ruth.db")
    fs.writeFileSync(db, Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(32)]))
    fs.writeFileSync(path.join(r.config, "ruth.json"), '{"model":"ollama/ruth"}\n')
    expect(needsQuarantine(r, db)).toBeUndefined()
    expect(recoverIfNeeded(r, db)).toEqual([])
    expect(fs.existsSync(db)).toBe(true)
  } finally {
    cleanup(r.home)
  }
})

test("moves a database path that is a directory aside and recreates a fresh data dir", () => {
  const r = roots()
  try {
    const db = path.join(r.data, "ruth.db")
    fs.mkdirSync(db, { recursive: true })
    fs.mkdirSync(r.config, { recursive: true })
    fs.writeFileSync(path.join(r.config, "ruth.json"), '{"model":"ollama/ruth"}\n')
    const moved = recoverIfNeeded(r, db)
    expect(moved.length).toBeGreaterThan(0)
    expect(fs.existsSync(db)).toBe(false)
    expect(fs.statSync(r.data).isDirectory()).toBe(true)
    expect(moved.some((item) => item.includes(".bak-"))).toBe(true)
  } finally {
    cleanup(r.home)
  }
})

test("moves unreadable json config and a legacy ~/.ruth.json aside", () => {
  const r = roots()
  try {
    fs.mkdirSync(r.data, { recursive: true })
    fs.mkdirSync(r.config, { recursive: true })
    fs.writeFileSync(path.join(r.config, "ruth.json"), "{ not json")
    fs.writeFileSync(path.join(r.home, ".ruth.json"), '{"LOCAL_ENDPOINT":"http://localhost:11434/v1"}')
    const db = path.join(r.data, "ruth.db")
    const moved = recoverIfNeeded(r, db)
    expect(moved.length).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(r.config, "ruth.json"))).toBe(false)
    expect(fs.existsSync(path.join(r.home, ".ruth.json"))).toBe(false)
  } finally {
    cleanup(r.home)
  }
})

test("boot-failure recovery only runs for database or config errors", () => {
  const r = roots()
  try {
    fs.mkdirSync(r.data, { recursive: true })
    fs.writeFileSync(path.join(r.data, "keep.txt"), "ok")
    expect(isDataBootFailure(new Error("Standalone server exited before reporting readiness"))).toBe(false)
    expect(recoverAfterBootFailure(r, new Error("EADDRINUSE"))).toBeUndefined()
    expect(fs.existsSync(path.join(r.data, "keep.txt"))).toBe(true)
    const error = new Error("Failed to open database")
    ;(error as Error & { cause: Error }).cause = new Error("SQLiteError: unable to open database file")
    const moved = recoverAfterBootFailure(r, error)
    expect(moved?.length).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(r.data, "keep.txt"))).toBe(false)
    expect(fs.statSync(r.data).isDirectory()).toBe(true)
  } finally {
    cleanup(r.home)
  }
})
