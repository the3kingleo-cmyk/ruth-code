import { expect, test } from "bun:test"
import { DEFAULT_PACKAGE, effectivePackage } from "../src/provider.ts"

test("falls back to the bundled openai-compatible package when the field is missing or empty", () => {
  expect(effectivePackage()).toBe(DEFAULT_PACKAGE)
  expect(effectivePackage(undefined, "")).toBe(DEFAULT_PACKAGE)
  expect(effectivePackage("  ", undefined)).toBe(DEFAULT_PACKAGE)
  expect(effectivePackage("", "@ruth/ai/providers/openai-compatible")).toBe(
    "@ruth/ai/providers/openai-compatible",
  )
  expect(effectivePackage("@ruth/ai/providers/ollama", "")).toBe("@ruth/ai/providers/ollama")
})
