import { describe, expect, test } from "bun:test"
import { LLMEvent, LLMResponse } from "../src/schema/index.js"
import { extractToolCallFromText, findJsonObjects, withTextToolCalls } from "../src/tool-call-extract.js"

const tools = new Set(["read", "write", "bash"])

const textResponse = (text: string, extra: ReadonlyArray<LLMEvent> = []) =>
  LLMResponse.fromEvents([
    LLMEvent.textStart({ id: "t1" }),
    LLMEvent.textDelta({ id: "t1", text }),
    LLMEvent.textEnd({ id: "t1" }),
    ...extra,
    LLMEvent.finish({ reason: { normalized: "stop" } }),
  ])!

describe("extractToolCallFromText", () => {
  test("lifts a single {name, arguments} object when the name is registered", () => {
    const found = extractToolCallFromText(
      'I will read it.\n{"name":"read","arguments":{"path":"a.ts"}}\n',
      tools,
    )
    expect(found).toEqual({ name: "read", arguments: { path: "a.ts" } })
  })

  test("accepts a fenced JSON block and the parameters key", () => {
    const found = extractToolCallFromText(
      "```json\n{\"name\":\"bash\",\"parameters\":{\"command\":\"ls\"}}\n```",
      tools,
    )
    expect(found).toEqual({ name: "bash", arguments: { command: "ls" } })
  })

  test("ignores objects whose name is not a registered tool", () => {
    expect(extractToolCallFromText('{"name":"not_a_tool","arguments":{"x":1}}', tools)).toBeUndefined()
  })

  test("ignores text when more than one registered tool object is present", () => {
    const text = '{"name":"read","arguments":{"path":"a"}}\n{"name":"write","arguments":{"path":"b"}}'
    expect(extractToolCallFromText(text, tools)).toBeUndefined()
  })

  test("accepts a flattened write call without an arguments wrapper", () => {
    const found = extractToolCallFromText(
      '{"name":"write","path":"hello.txt","content":"hi"}',
      new Set(["write"]),
    )
    expect(found).toEqual({ name: "write", arguments: { path: "hello.txt", content: "hi" } })
  })

  test("finds nested-looking sibling objects via brace matching", () => {
    expect(findJsonObjects('before {"name":"read","arguments":{"path":"a.ts"}} after').length).toBe(1)
  })
})

describe("withTextToolCalls", () => {
  test("does not invent a call when a native tool call is already present", () => {
    const response = textResponse('{"name":"read","arguments":{"path":"a.ts"}}', [
      LLMEvent.toolCall({ id: "native", name: "bash", input: { command: "ls" } }),
    ])
    const next = withTextToolCalls(response, tools)
    expect(next.toolCalls.map((call) => call.id)).toEqual(["native"])
  })

  test("appends a synthetic tool call when text contains exactly one registered object", () => {
    const response = textResponse('{"name":"read","arguments":{"path":"a.ts"}}')
    const next = withTextToolCalls(response, tools)
    expect(next.toolCalls).toHaveLength(1)
    expect(next.toolCalls[0]).toMatchObject({ name: "read", input: { path: "a.ts" } })
  })
})
