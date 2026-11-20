import { expect, test } from "bun:test"
import { hasRuthModel, listModelNames, ruthModelfile } from "../src/ensure-ruth-model"

test("treats ruth and ruth:latest as the default model", () => {
  expect(hasRuthModel(["ruth:latest"])).toBe(true)
  expect(hasRuthModel(["ruth"])).toBe(true)
  expect(hasRuthModel(["huihui_ai/qwen3.5-abliterated:2b"])).toBe(false)
})

test("reads names from an Ollama /api/tags payload", () => {
  expect(listModelNames({ models: [{ name: "ruth:latest", model: "ruth:latest" }] })).toEqual([
    "ruth:latest",
    "ruth:latest",
  ])
})

test("modelfile pins the bundled blob, identity, and a usable context", () => {
  const file = ruthModelfile()
  expect(file).toContain("FROM sha256:11e56b54062941d7c415ddb083375eb227004b3c23134d340d0cd9c334b73662")
  expect(file).toContain("You are Ruth, a coding agent.")
  expect(file).toContain("PARAMETER num_ctx 16384")
  expect(file).not.toContain("David's coding agent")
})
