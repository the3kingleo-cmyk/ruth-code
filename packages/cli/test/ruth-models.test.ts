import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { RUTH_SYSTEM_PROMPT } from "../src/ruth-models"

describe("RUTH_SYSTEM_PROMPT", () => {
  test("identifies as Ruth and keeps the local tool-call guidance", () => {
    expect(RUTH_SYSTEM_PROMPT).toContain("Your name is Ruth.")
    expect(RUTH_SYSTEM_PROMPT).toContain("I'm Ruth.")
    expect(RUTH_SYSTEM_PROMPT).not.toContain("You are Ruth, an uncensored")
    expect(RUTH_SYSTEM_PROMPT).not.toContain("all-purpose assistant")
    expect(RUTH_SYSTEM_PROMPT).not.toContain("Use the screenshot tool")
    expect(RUTH_SYSTEM_PROMPT).not.toContain("camera tool")
    expect(RUTH_SYSTEM_PROMPT).toContain("Never list your capabilities")
    expect(RUTH_SYSTEM_PROMPT).toContain('path="hello.txt" and content="hi"')
    expect(RUTH_SYSTEM_PROMPT).toContain("git clone")
  })

  test("matches the Modelfile prompt in the model setup script", () => {
    const script = readFileSync(path.join(import.meta.dir, "../../../scripts/create-ruth-models.sh"), "utf8")
    const quoted = script.match(/SYSTEM_PROMPT='([\s\S]*?)'\n/)?.[1]?.replaceAll("'\\''", "'")
    expect(quoted).toBe(RUTH_SYSTEM_PROMPT)
  })
})
