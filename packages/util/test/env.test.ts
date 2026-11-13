import { afterEach, describe, expect, test } from "bun:test"
import { applyJcodeEnvFallbacks, env } from "../src/env.js"

afterEach(() => {
  delete process.env.JCODE_SAMPLE
  delete process.env.OPENCODE_SAMPLE
})

describe("env", () => {
  test("prefers JCODE_ over OPENCODE_", () => {
    process.env.OPENCODE_SAMPLE = "legacy"
    process.env.JCODE_SAMPLE = "new"
    expect(env("SAMPLE")).toBe("new")
    expect(env("OPENCODE_SAMPLE")).toBe("new")
  })

  test("falls back to OPENCODE_ when JCODE_ is unset", () => {
    process.env.OPENCODE_SAMPLE = "legacy"
    expect(env("SAMPLE")).toBe("legacy")
  })
})

describe("applyJcodeEnvFallbacks", () => {
  test("copies JCODE_ onto an unset OPENCODE_ equivalent", () => {
    const target: NodeJS.ProcessEnv = { JCODE_FLAGS: "schedules" }
    applyJcodeEnvFallbacks(target)
    expect(target.OPENCODE_FLAGS).toBe("schedules")
  })
})
