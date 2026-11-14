import { afterEach, describe, expect, test } from "bun:test"
import { applyRuthEnvFallbacks, env } from "../src/env.js"

afterEach(() => {
  delete process.env.RUTH_SAMPLE
  delete process.env.JCODE_SAMPLE
})

describe("env", () => {
  test("prefers RUTH_ over JCODE_", () => {
    process.env.JCODE_SAMPLE = "jarvis"
    process.env.RUTH_SAMPLE = "ruth"
    expect(env("SAMPLE")).toBe("ruth")
    expect(env("JCODE_SAMPLE")).toBe("ruth")
  })

  test("falls back to JCODE_ when RUTH_ is unset", () => {
    process.env.JCODE_SAMPLE = "jarvis"
    expect(env("SAMPLE")).toBe("jarvis")
  })
})

describe("applyRuthEnvFallbacks", () => {
  test("copies RUTH_ onto unset JCODE_ equivalents", () => {
    const target: NodeJS.ProcessEnv = { RUTH_FLAGS: "schedules" }
    applyRuthEnvFallbacks(target)
    expect(target.JCODE_FLAGS).toBe("schedules")
  })
})
