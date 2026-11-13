import { afterEach, describe, expect, test } from "bun:test"
import { defaultIdleTimeout, resolveIdleTimeoutMs } from "../src/solid/connection.ts"

const keys = ["OPENCODE_SSE_IDLE_TIMEOUT", "JCODE_SSE_IDLE_TIMEOUT", "RUTH_SSE_IDLE_TIMEOUT"] as const

afterEach(() => {
  for (const key of keys) delete process.env[key]
})

describe("resolveIdleTimeoutMs", () => {
  test("defaults to 10 minutes", () => {
    expect(defaultIdleTimeout).toBe(600_000)
    expect(resolveIdleTimeoutMs()).toBe(600_000)
  })

  test("honors an explicit option, including 0 to disable", () => {
    expect(resolveIdleTimeoutMs(45_000)).toBe(45_000)
    expect(resolveIdleTimeoutMs(0)).toBe(0)
  })

  test("reads RUTH_, JCODE_, and OPENCODE_ SSE idle timeouts, with RUTH winning", () => {
    process.env.OPENCODE_SSE_IDLE_TIMEOUT = "120000"
    expect(resolveIdleTimeoutMs()).toBe(120_000)
    process.env.JCODE_SSE_IDLE_TIMEOUT = "900000"
    expect(resolveIdleTimeoutMs()).toBe(900_000)
    process.env.RUTH_SSE_IDLE_TIMEOUT = "180000"
    expect(resolveIdleTimeoutMs()).toBe(180_000)
  })

  test("treats 0, false, and off as disabled", () => {
    process.env.OPENCODE_SSE_IDLE_TIMEOUT = "off"
    expect(resolveIdleTimeoutMs()).toBe(0)
  })
})
