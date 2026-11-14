import { expect, test } from "bun:test"
import { SessionSystemPrompt } from "@ruth/core/session/system-prompt"

test("renders the default system prompt instructions", () => {
  const prompt = SessionSystemPrompt.make(["edit", "read", "shell"])
  expect(prompt).not.toContain("${RUTH_TOOL_GUIDANCE}")
  expect(prompt).toContain("Use the edit tool for targeted changes to existing text files")
})
