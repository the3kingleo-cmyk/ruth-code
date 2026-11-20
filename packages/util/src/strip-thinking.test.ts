import { describe, expect, test } from "bun:test"
import { stripOllamaThinking } from "./strip-thinking"

describe("stripOllamaThinking", () => {
  test("removes think tags around a hidden chain of thought", () => {
    expect(stripOllamaThinking("<think>plan the reply</think>\nI am Ruth, an all-purpose assistant.")).toBe(
      "I am Ruth, an all-purpose assistant.",
    )
  })

  test("drops a trailing untagged monologue after a tool answer", () => {
    const input = `File created successfully: hello.txt (content: hi)
Okay, the user wants to create a file called hello.txt with the content "hi". Let me think about the tools available.`
    expect(stripOllamaThinking(input)).toBe("File created successfully: hello.txt (content: hi)")
  })

  test("drops a standalone monologue with no preceding answer", () => {
    expect(
      stripOllamaThinking(
        'Okay, the user wants to create a file called hello.txt with the content "hi". Let me see which tool to use.',
      ),
    ).toBe("")
  })

  test("leaves ordinary answers alone", () => {
    expect(stripOllamaThinking("I'm Ruth.")).toBe("I'm Ruth.")
  })

  test("drops a trailing customer-service offer", () => {
    expect(stripOllamaThinking("File created successfully. Let me know if you need anything else!")).toBe(
      "File created successfully.",
    )
  })
})
