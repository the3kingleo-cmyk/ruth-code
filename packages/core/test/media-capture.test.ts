import { describe, expect, test } from "bun:test"
import path from "node:path"
import { timestampedPath, which } from "../src/tool/media-capture"

describe("media-capture", () => {
  test("timestampedPath writes under Pictures/ruth", () => {
    const now = new Date(2026, 10, 13, 15, 21, 4) // months are 0-based
    const file = timestampedPath("screenshot", ".png", now)
    expect(file.endsWith(`${path.sep}Pictures${path.sep}ruth${path.sep}screenshot-20261113-152104.png`)).toBe(true)
  })

  test("which finds sh and not a missing binary", async () => {
    expect(await which("sh")).toBeTruthy()
    expect(await which("ruth-definitely-missing-binary-xyz")).toBeUndefined()
  })
})
