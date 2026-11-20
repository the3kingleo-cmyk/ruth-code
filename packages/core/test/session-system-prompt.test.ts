import { expect, test } from "bun:test"
import { SessionSystemPrompt } from "@ruth/core/session/system-prompt"

test("renders Ruth's system prompt with tool guidance for the enabled tools", () => {
  const prompt = SessionSystemPrompt.make(["edit", "read", "shell"])
  expect(prompt).not.toContain("${RUTH_TOOL_GUIDANCE}")
  expect(prompt).toContain("You are Ruth")
  expect(prompt).toContain("Use edit for targeted changes")
})
