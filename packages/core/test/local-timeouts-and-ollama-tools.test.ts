import { afterEach, describe, expect, test } from "bun:test"
import { DEFAULT_LOCAL_HEADER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, isLocalProvider, timeouts } from "../src/provider.ts"
import { shouldAssumeOllamaTools } from "../src/plugin/provider/ollama.ts"
import { TITLE_MAX_TOKENS } from "../src/session/model-request.ts"

afterEach(() => {
  delete process.env.OPENCODE_OLLAMA_ASSUME_TOOLS
  delete process.env.JCODE_OLLAMA_ASSUME_TOOLS
})

describe("local provider timeouts", () => {
  test("uses a 20-minute header timeout for ollama when unset", () => {
    expect(isLocalProvider("ollama")).toBe(true)
    expect(timeouts({}, "ollama").headerTimeout).toBe(DEFAULT_LOCAL_HEADER_TIMEOUT_MS)
    expect(timeouts({}, "openai").headerTimeout).toBe(DEFAULT_TIMEOUT_MS)
  })

  test("keeps an explicit headerTimeout, including false", () => {
    expect(timeouts({ headerTimeout: false }, "ollama").headerTimeout).toBe(false)
    expect(timeouts({ headerTimeout: 60_000 }, "ollama").headerTimeout).toBe(60_000)
  })
})

describe("shouldAssumeOllamaTools", () => {
  test("is off by default and on when configured", () => {
    expect(shouldAssumeOllamaTools()).toBe(false)
    process.env.OPENCODE_OLLAMA_ASSUME_TOOLS = "1"
    expect(shouldAssumeOllamaTools()).toBe(true)
  })
})

describe("title generation bound", () => {
  test("caps title output tokens", () => {
    expect(TITLE_MAX_TOKENS).toBe(128)
  })
})
