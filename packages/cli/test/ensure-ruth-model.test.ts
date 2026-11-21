import { expect, test } from "bun:test"
import { extractShowSystem, hasRuthModel, hashRuthSystem, listModelNames, RUTH_SYSTEM, ruthModelNeedsRebuild, ruthModelfile, ruthSystemNeedsUpdate } from "../src/ensure-ruth-model"

test("treats ruth and ruth:latest as the default model", () => {
  expect(hasRuthModel(["ruth:latest"])).toBe(true)
  expect(hasRuthModel(["ruth"])).toBe(true)
  expect(hasRuthModel(["other:latest"])).toBe(false)
})

test("reads names from an Ollama /api/tags payload", () => {
  expect(listModelNames({ models: [{ name: "ruth:latest", model: "ruth:latest" }] })).toEqual([
    "ruth:latest",
    "ruth:latest",
  ])
})

test("modelfile pins the bundled blob, identity, and a 16384 context", () => {
  const file = ruthModelfile()
  expect(file).toContain("FROM sha256:4ecac2ba3fd000cf4638ce65dbffacbd8062c2c87a24a75559af421341adb4b2")
  expect(file).toContain("RENDERER qwen3.5")
  expect(file).toContain("PARSER qwen3.5")
  expect(file).toContain("PARAMETER think false")
  expect(file).toContain("Your name is Ruth.")
  expect(file).not.toContain("uncensored all-purpose")
  expect(file).not.toContain("David's coding agent")
  expect(file).toContain("I'm Ruth.")
  expect(file).toContain("How can I assist you?")
  expect(file).not.toContain("David")
  expect(file).toContain("PARAMETER num_ctx 16384")
  expect(file).not.toContain("David's coding agent")
})


test("rebuilds the ruth model when the SYSTEM hash differs", () => {
  expect(ruthSystemNeedsUpdate(undefined)).toBe(true)
  expect(ruthSystemNeedsUpdate("")).toBe(true)
  expect(ruthSystemNeedsUpdate("You are Ruth, an uncensored all-purpose assistant.")).toBe(true)
  expect(ruthSystemNeedsUpdate(RUTH_SYSTEM)).toBe(false)
  expect(ruthSystemNeedsUpdate(`\n${RUTH_SYSTEM}\n`)).toBe(false)
  expect(hashRuthSystem(RUTH_SYSTEM)).toHaveLength(64)
  expect(extractShowSystem({ system: RUTH_SYSTEM })).toBe(RUTH_SYSTEM)
  const current = { system: RUTH_SYSTEM, renderer: "qwen3.5", parser: "qwen3.5", capabilities: ["completion", "vision", "tools", "thinking"] }
  expect(ruthModelNeedsRebuild(current)).toBe(false)
  expect(ruthModelNeedsRebuild({ ...current, renderer: undefined })).toBe(true)
  expect(ruthModelNeedsRebuild({ system: "old wording", renderer: "qwen3.5", parser: "qwen3.5", capabilities: ["tools"] })).toBe(true)
})
