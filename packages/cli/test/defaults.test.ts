import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { ensureDefaultConfig, findExistingConfig } from "../src/defaults"

describe("ensureDefaultConfig", () => {
  test("creates ruth.json once and leaves an existing file alone", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ruth-config-"))
    const first = ensureDefaultConfig({ directory })
    expect(first.created).toBe(true)
    expect(fs.readFileSync(first.path, "utf8")).toContain("huihui_ai/qwen3-abliterated:1.7b")
    const second = ensureDefaultConfig({ directory })
    expect(second.created).toBe(false)
    expect(second.path).toBe(first.path)
    expect(findExistingConfig(directory)).toBe(first.path)
    fs.rmSync(directory, { recursive: true, force: true })
  })
})
