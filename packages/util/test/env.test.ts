import { afterEach, describe, expect, test } from "bun:test"
import { applyRuthEnvFallbacks, env } from "../src/env.js"

afterEach(() => {
  delete process.env.RUTH_SAMPLE
  delete process.env.JCODE_SAMPLE
  delete process.env.OPENCODE_SAMPLE
})

describe("env", () => {
  test("prefers RUTH_ over JCODE_ and OPENCODE_", () => {
    process.env.OPENCODE_SAMPLE = "legacy"
    process.env.JCODE_SAMPLE = "jarvis"
    process.env.RUTH_SAMPLE = "ruth"
    expect(env("SAMPLE")).toBe("ruth")
    expect(env("OPENCODE_SAMPLE")).toBe("ruth")
  })

  test("falls back to JCODE_ when RUTH_ is unset", () => {
    process.env.OPENCODE_SAMPLE = "legacy"
    process.env.JCODE_SAMPLE = "jarvis"
    expect(env("SAMPLE")).toBe("jarvis")
  })

  test("falls back to OPENCODE_ when newer prefixes are unset", () => {
    process.env.OPENCODE_SAMPLE = "legacy"
    expect(env("SAMPLE")).toBe("legacy")
  })
})

describe("applyRuthEnvFallbacks", () => {
  test("copies RUTH_ onto unset JCODE_ and OPENCODE_ equivalents", () => {
    const target: NodeJS.ProcessEnv = { RUTH_FLAGS: "schedules" }
    applyRuthEnvFallbacks(target)
    expect(target.JCODE_FLAGS).toBe("schedules")
    expect(target.OPENCODE_FLAGS).toBe("schedules")
  })
})
