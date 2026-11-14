import { afterEach, describe, expect, test } from "bun:test"
import { shouldEnableFilewatcher } from "../src/filewatcher-policy"

const keys = [
  "RUTH_FILEWATCHER_DISABLE",
  "RUTH_FILEWATCHER_DISABLE",
  "RUTH_DISABLE_FILEWATCHER",
  "RUTH_DISABLE_FILEWATCHER",
]

afterEach(() => {
  for (const key of keys) delete process.env[key]
})

describe("shouldEnableFilewatcher", () => {
  test("is on by default", () => {
    expect(shouldEnableFilewatcher(2_048_000).enabled).toBe(true)
    expect(shouldEnableFilewatcher(2_048_000).reason).toBe("default-on")
  })

  test("turns off only when memory is low", () => {
    expect(shouldEnableFilewatcher(100_000)).toEqual({ enabled: false, reason: "low-memory" })
  })

  test("honors an explicit disable", () => {
    process.env.RUTH_FILEWATCHER_DISABLE = "1"
    expect(shouldEnableFilewatcher(100_000)).toEqual({ enabled: false, reason: "explicit-off" })
  })
})
