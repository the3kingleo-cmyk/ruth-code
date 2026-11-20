import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import {
  LOCAL_OLLAMA_ORIGIN,
  clearCloudState,
  cloudOriginFromState,
  normalizeOllamaOrigin,
  preferLoopbackHost,
  resolveOllamaOrigin,
  writeCloudState,
} from "../src/ollama-origin.js"

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ruth-origin-"))

afterEach(() => {
  delete process.env.RUTH_TEST_HOME
  delete process.env.RUTH_XDG_STATE_HOME
  delete process.env.JCODE_XDG_STATE_HOME
  delete process.env.RUTH_XDG_STATE_HOME
  delete process.env.RUTH_OLLAMA_ORIGIN
  delete process.env.JCODE_OLLAMA_ORIGIN
  delete process.env.RUTH_OLLAMA_ORIGIN
})

function isolate() {
  const home = fs.mkdtempSync(path.join(temp, "home-"))
  const state = path.join(home, "state")
  fs.mkdirSync(state, { recursive: true })
  process.env.RUTH_TEST_HOME = home
  process.env.RUTH_XDG_STATE_HOME = state
  return home
}

describe("resolveOllamaOrigin", () => {
  test("falls back to local Ollama when there is no cloud state", () => {
    isolate()
    expect(resolveOllamaOrigin({ probe: () => true })).toBe(LOCAL_OLLAMA_ORIGIN)
  })

  test("prefers a healthy cloud tunnel", () => {
    isolate()
    writeCloudState({ localPort: 11435, name: "ruth-ollama-abc" })
    expect(resolveOllamaOrigin({ probe: (origin: string) => origin.includes("11435") })).toBe("http://127.0.0.1:11435")
  })

  test("falls back to local when the tunnel is down", () => {
    isolate()
    writeCloudState({ localPort: 11435, name: "ruth-ollama-abc" })
    expect(resolveOllamaOrigin({ probe: () => false })).toBe(LOCAL_OLLAMA_ORIGIN)
  })

  test("honors an explicit RUTH_OLLAMA_ORIGIN pin", () => {
    isolate()
    writeCloudState({ localPort: 11435 })
    process.env.RUTH_OLLAMA_ORIGIN = "http://127.0.0.1:19999/v1"
    expect(resolveOllamaOrigin({ probe: () => true })).toBe("http://127.0.0.1:19999")
  })

  test("clearCloudState removes the state file", () => {
    isolate()
    const file = writeCloudState({ localPort: 11435 })
    expect(fs.existsSync(file)).toBe(true)
    clearCloudState()
    expect(fs.existsSync(file)).toBe(false)
  })

  test("cloudOriginFromState uses the recorded local port", () => {
    expect(cloudOriginFromState({ localPort: 12000 })).toBe("http://127.0.0.1:12000")
  })
})


describe("preferLoopbackHost", () => {
  test("rewrites localhost and IPv6 loopback to 127.0.0.1", () => {
    expect(preferLoopbackHost("http://localhost:11434/v1")).toBe("http://127.0.0.1:11434/v1")
    expect(preferLoopbackHost("http://[::1]:11434")).toBe("http://127.0.0.1:11434")
    expect(preferLoopbackHost("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434/v1")
  })

  test("normalizeOllamaOrigin strips /v1 and rewrites localhost", () => {
    expect(normalizeOllamaOrigin("http://localhost:11434/v1")).toBe("http://127.0.0.1:11434")
  })
})
