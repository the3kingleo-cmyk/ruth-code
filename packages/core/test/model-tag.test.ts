import { describe, expect, test } from "bun:test"
import { alternateModelTag, modelTagMatches } from "../src/model.ts"

describe("Ollama model tag aliases", () => {
  test("maps a bare name to :latest and back", () => {
    expect(alternateModelTag("ruth")).toBe("ruth:latest")
    expect(alternateModelTag("ruth:latest")).toBe("ruth")
    expect(alternateModelTag("huihui_ai/qwen3-abliterated:1.7b")).toBeUndefined()
  })

  test("treats ruth and ruth:latest as the same model", () => {
    expect(modelTagMatches("ruth:latest", "ruth")).toBe(true)
    expect(modelTagMatches("ruth", "ruth:latest")).toBe(true)
    expect(modelTagMatches("ruth", "ruth")).toBe(true)
    expect(modelTagMatches("ruth-pro:latest", "ruth")).toBe(false)
  })
})
