import { describe, expect, test } from "bun:test"
import { createHash } from "crypto"
import fs from "fs"
import os from "os"
import path from "path"
import { healthCheck, rollbackBinary, selfUpdate } from "../src/self-update"

function writeScript(file: string, body: string) {
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`)
  fs.chmodSync(file, 0o755)
}

describe("self-update", () => {
  test("verifies sha256, replaces the binary, and keeps a previous copy", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ruth-update-"))
    const current = path.join(root, "ruth")
    const incoming = path.join(root, "incoming", "ruth")
    fs.mkdirSync(path.dirname(incoming), { recursive: true })
    writeScript(current, 'echo "ruth v1"')
    writeScript(incoming, 'echo "ruth v2"')
    const archive = path.join(root, "ruth-linux-x64.tar.gz")
    fs.writeFileSync(archive, "ARCHIVE")
    const sha = createHash("sha256").update("ARCHIVE").digest("hex")
    const result = await selfUpdate({
      currentVersion: "1",
      currentBinary: current,
      token: "test-token",
      chatCheck: false,
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.endsWith("/releases/latest")) {
          return new Response(
            JSON.stringify({
              tag_name: "v2",
              assets: [
                {
                  name: "ruth-linux-x64.tar.gz",
                  url: "https://example.com/asset",
                  digest: `sha256:${sha}`,
                },
              ],
            }),
            { status: 200 },
          )
        }
        return new Response("ARCHIVE", { status: 200 })
      },
      extract: () => incoming,
      run: (cmd, args) => {
        if (String(cmd).includes("ruth") && args?.[0] === "--version") {
          return { status: 0, stdout: "ruth v2\n", stderr: "" } as ReturnType<typeof import("child_process").spawnSync>
        }
        return { status: 1, stdout: "", stderr: "no" } as ReturnType<typeof import("child_process").spawnSync>
      },
    })
    expect(result.ok).toBe(true)
    expect(result.action).toBe("updated")
    expect(fs.readFileSync(current, "utf8")).toContain("ruth v2")
    expect(fs.existsSync(current + ".prev")).toBe(true)
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("rolls back when the installed binary fails its health check", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ruth-rollback-"))
    const current = path.join(root, "ruth")
    const incoming = path.join(root, "incoming", "ruth")
    fs.mkdirSync(path.dirname(incoming), { recursive: true })
    writeScript(current, 'echo "ruth v1"')
    writeScript(incoming, "exit 1")
    const archive = path.join(root, "ruth-linux-x64.tar.gz")
    fs.writeFileSync(archive, "ARCHIVE")
    const sha = createHash("sha256").update("ARCHIVE").digest("hex")
    let installedChecks = 0
    const result = await selfUpdate({
      currentVersion: "1",
      currentBinary: current,
      token: "test-token",
      chatCheck: false,
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.endsWith("/releases/latest")) {
          return new Response(
            JSON.stringify({
              tag_name: "v2",
              assets: [{ name: "ruth-linux-x64.tar.gz", url: "https://example.com/asset", digest: `sha256:${sha}` }],
            }),
            { status: 200 },
          )
        }
        return new Response("ARCHIVE", { status: 200 })
      },
      extract: () => incoming,
      run: (cmd) => {
        const target = String(cmd)
        if (target === incoming) return { status: 0, stdout: "ruth v2\n", stderr: "" } as never
        if (target === current) {
          installedChecks += 1
          return { status: 1, stdout: "", stderr: "boom" } as never
        }
        return { status: 1, stdout: "", stderr: "no" } as never
      },
    })
    expect(result.action).toBe("rolled-back")
    expect(result.ok).toBe(false)
    expect(fs.readFileSync(current, "utf8")).toContain("ruth v1")
    expect(installedChecks).toBeGreaterThan(0)
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("healthCheck fails a binary that cannot print a version", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ruth-health-"))
    const binary = path.join(root, "ruth")
    writeScript(binary, "exit 2")
    const result = healthCheck(binary, { chatCheck: false })
    expect(result.ok).toBe(false)
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("rollbackBinary restores the previous copy", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ruth-rb-"))
    const current = path.join(root, "ruth")
    const previous = current + ".prev"
    writeScript(current, 'echo bad')
    writeScript(previous, 'echo good')
    rollbackBinary(current, previous)
    expect(fs.readFileSync(current, "utf8")).toContain("good")
    fs.rmSync(root, { recursive: true, force: true })
  })
})
