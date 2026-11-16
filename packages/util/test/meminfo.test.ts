import { describe, expect, test } from "bun:test"
import { isLowMemory, LOW_MEMORY_KIB, readMemAvailableKiB } from "../src/meminfo.js"

describe("meminfo", () => {
  test("parses MemAvailable", () => {
    const text = "MemTotal:        8000000 kB\nMemAvailable:    2048000 kB\n"
    expect(readMemAvailableKiB(text)).toBe(2_048_000)
  })

  test("treats under 768 MiB as low memory", () => {
    expect(isLowMemory(LOW_MEMORY_KIB - 1)).toBe(true)
    expect(isLowMemory(LOW_MEMORY_KIB)).toBe(false)
  })
})
