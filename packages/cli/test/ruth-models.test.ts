import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { RUTH_SYSTEM_PROMPT } from "../src/ruth-models"

describe("RUTH_SYSTEM_PROMPT", () => {
  test("identifies as Ruth and keeps the local tool-call guidance", () => {
    expect(RUTH_SYSTEM_PROMPT.startsWith("You are Ruth")).toBe(true)
    expect(RUTH_SYSTEM_PROMPT).toContain("not Qwen")
    expect(RUTH_SYSTEM_PROMPT).toContain("Make real tool calls")
    expect(RUTH_SYSTEM_PROMPT).toContain("Use one tool at a time")
    expect(RUTH_SYSTEM_PROMPT).toContain('path="hello.txt" and content="hello Ruth"')
    expect(RUTH_SYSTEM_PROMPT).toContain("run the tests, typecheck, or build")
    expect(RUTH_SYSTEM_PROMPT).toContain("/models")
  })

  test("matches the Modelfile prompt in the model setup script", () => {
    const script = readFileSync(path.join(import.meta.dir, "../../../scripts/create-ruth-models.sh"), "utf8")
    const quoted = script.match(/SYSTEM_PROMPT='([\s\S]*?)'\n/)?.[1]?.replaceAll("'\\''", "'")
    expect(quoted).toBe(RUTH_SYSTEM_PROMPT)
  })
})
