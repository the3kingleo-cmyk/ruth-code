import { afterAll, describe, expect, test } from "bun:test"
import { normalizeServerURL, ollamaServeContext } from "../src/local-servers.js"

const servers: ReturnType<typeof Bun.serve>[] = []
afterAll(() => servers.forEach((server) => server.stop(true)))

describe("ollama helpers", () => {
  test("normalizes Ollama addresses", () => {
    expect(normalizeServerURL("127.0.0.1:11434")).toBe("http://127.0.0.1:11434")
    expect(normalizeServerURL("http://127.0.0.1:11434/v1/")).toBe("http://127.0.0.1:11434")
    expect(normalizeServerURL("http://box:11434/api")).toBe("http://box:11434")
  })

  test("uses a real context length", () => {
    expect(ollamaServeContext()).toBeGreaterThanOrEqual(2048)
  })
})
