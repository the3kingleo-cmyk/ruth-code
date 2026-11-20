import { expect, test } from "bun:test"
import { githubCloneUrl, rewriteGhRepoClone, rewriteShellCommand } from "../../src/tool/plugin/shell-rewrite.ts"

test("translates gh repo clone aliases to git clone URLs", () => {
  expect(rewriteGhRepoClone("gh repo clone opencode-ai/opencode")).toBe(
    "git clone https://github.com/opencode-ai/opencode",
  )
  expect(rewriteGhRepoClone("gh repo clone opencode-ai/opencode dest")).toBe(
    "git clone https://github.com/opencode-ai/opencode dest",
  )
  expect(rewriteGhRepoClone("gh repo clone opencode-ai/opencode -- --depth 1")).toBe(
    "git clone https://github.com/opencode-ai/opencode --depth 1",
  )
  expect(rewriteGhRepoClone("gh repo clone https://github.com/opencode-ai/opencode")).toBe(
    "git clone https://github.com/opencode-ai/opencode",
  )
  expect(githubCloneUrl("github.com/opencode-ai/opencode")).toBe("https://github.com/opencode-ai/opencode")
  expect(rewriteGhRepoClone("ls")).toBeUndefined()
})

test("rewrites only when gh is missing", () => {
  const command = "gh repo clone opencode-ai/opencode"
  expect(rewriteShellCommand(command, { hasGh: true })).toBe(command)
  expect(rewriteShellCommand(command, { hasGh: false })).toBe("git clone https://github.com/opencode-ai/opencode")
})
