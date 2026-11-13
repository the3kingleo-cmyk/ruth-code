import { describe, expect, test } from "bun:test"
import { RUTH_SYSTEM_PROMPT } from "../src/ruth-models"

describe("RUTH_SYSTEM_PROMPT", () => {
  test("identifies as Ruth, David's coding agent", () => {
    expect(RUTH_SYSTEM_PROMPT.startsWith("You are Ruth, David's coding agent")).toBe(true)
    expect(RUTH_SYSTEM_PROMPT).toContain("make a real tool call")
    expect(RUTH_SYSTEM_PROMPT).toContain('content="hello Ruth"')
    expect(RUTH_SYSTEM_PROMPT).toContain('path="hello.txt"')
  })
})
