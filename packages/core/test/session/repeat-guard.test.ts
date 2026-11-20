import { expect, test } from "bun:test"
import { alreadyFailed, clear, rememberFailure } from "../../src/session/runner/repeat-guard.ts"

test("remembers an identical failing call and can be cleared", () => {
  const session = "ses_test"
  clear(session)
  expect(alreadyFailed(session, "shell", { command: "gh repo clone x/y" })).toBe(false)
  rememberFailure(session, "shell", { command: "gh repo clone x/y" })
  expect(alreadyFailed(session, "shell", { command: "gh repo clone x/y" })).toBe(true)
  expect(alreadyFailed(session, "shell", { command: "git clone https://github.com/x/y" })).toBe(false)
  clear(session)
  expect(alreadyFailed(session, "shell", { command: "gh repo clone x/y" })).toBe(false)
})
