import { describe, expect, test } from "bun:test"
import { parse } from "jsonc-parser"
import { connectConfig, preferredModel } from "../src/connect"

const server = (kind: "ollama" | "lmstudio" | "local", baseURL: string, models: string[] = []) => ({
  kind,
  name: kind,
  baseURL,
  models,
})

describe("ruth connect config", () => {
  test("writes a non-default address and keeps comments", () => {
    const next = connectConfig('{\n  // mine\n  "model": "ollama/ruth"\n}\n', server("lmstudio", "http://gpu:1234/v1"), "qwen3-4b")
    expect(next).toContain("// mine")
    expect(parse(next)).toEqual({
      model: "lmstudio/qwen3-4b",
      providers: { lmstudio: { settings: { baseURL: "http://gpu:1234/v1" } } },
    })
  })

  test("needs no setting for the default address and drops a conflicting legacy block", () => {
    const text = JSON.stringify({ model: "ollama/ruth", provider: { ollama: { options: { headerTimeout: 1 } } } })
    expect(JSON.parse(connectConfig(text, server("ollama", "http://localhost:11434/v1")))).toEqual({ model: "ollama/ruth" })
  })

  test("removes a stale address when the server moves back to its default", () => {
    const text = JSON.stringify({ providers: { ollama: { settings: { baseURL: "http://old:11434/v1" } } } })
    expect(JSON.parse(connectConfig(text, server("ollama", "http://127.0.0.1:11434/v1")))).toEqual({
      providers: { ollama: { settings: {} } },
    })
  })

  test("prefers Ruth's own model", () => {
    expect(preferredModel(server("ollama", "x", ["llama3.2", "ruth", "ruth-text"]))).toBe("ruth")
    expect(preferredModel(server("local", "x", ["mistral"]))).toBe("mistral")
  })
})
