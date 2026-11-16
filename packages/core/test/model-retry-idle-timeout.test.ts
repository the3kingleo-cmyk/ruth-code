import { describe, expect, test } from "bun:test"
import { isTimeoutCode } from "../src/model-retry.ts"

describe("isTimeoutCode", () => {
  test("counts both Timeout and idle-timeout toward the retry cap", () => {
    expect(isTimeoutCode("Timeout")).toBe(true)
    expect(isTimeoutCode("idle-timeout")).toBe(true)
    expect(isTimeoutCode("ECONNRESET")).toBe(false)
    expect(isTimeoutCode(undefined)).toBe(false)
  })
})
