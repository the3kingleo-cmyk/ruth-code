import { expect, test } from "bun:test"
import { defaultCloneDir, parseCloneRequest } from "../../src/session/runner/clone-fallback.ts"

test("parses clone and gh repo clone requests", () => {
  expect(parseCloneRequest("gh repo clone opencode-ai/opencode")).toEqual({
    url: "https://github.com/opencode-ai/opencode",
    dest: undefined,
    flags: [],
  })
  expect(parseCloneRequest("clone https://github.com/opencode-ai/opencode")).toEqual({
    url: "https://github.com/opencode-ai/opencode",
    dest: undefined,
    flags: [],
  })
  expect(parseCloneRequest("please run gh repo clone opencode-ai/opencode dest")).toEqual({
    url: "https://github.com/opencode-ai/opencode",
    dest: "dest",
    flags: [],
  })
  expect(parseCloneRequest("how do I clone a repo?")).toBeUndefined()
  expect(defaultCloneDir("https://github.com/opencode-ai/opencode.git")).toBe("opencode")
})
