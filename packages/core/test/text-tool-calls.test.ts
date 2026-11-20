import { describe, expect, test } from "bun:test"
import { LLMEvent } from "@ruth/ai/effect"
import { Effect, Stream } from "effect"
import { TextToolCalls } from "../src/session/runner/text-tool-calls"

const names = new Set(["read", "bash", "edit"])

describe("TextToolCalls.parse", () => {
  test("Hermes / Qwen <tool_call> JSON", () => {
    const result = TextToolCalls.parse(
      'Let me look.\n<tool_call>\n{"name": "read", "arguments": {"filePath": "a.ts"}}\n</tool_call>',
      names,
    )
    expect(result).toEqual({ calls: [{ name: "read", input: { filePath: "a.ts" } }], prose: "Let me look." })
  })

  test("multiple <tool_call> blocks and string arguments", () => {
    const result = TextToolCalls.parse(
      '<tool_call>{"name":"read","arguments":"{\\"filePath\\":\\"a\\"}"}</tool_call><tool_call>{"name":"bash","arguments":{"command":"ls"}}</tool_call>',
      names,
    )
    expect(result?.calls).toEqual([
      { name: "read", input: { filePath: "a" } },
      { name: "bash", input: { command: "ls" } },
    ])
  })

  test("Qwen3-Coder <function=> XML", () => {
    const result = TextToolCalls.parse(
      "<tool_call>\n<function=bash>\n<parameter=command>\nls -la\n</parameter>\n<parameter=timeout>\n5000\n</parameter>\n</function>\n</tool_call>",
      names,
    )
    expect(result?.calls).toEqual([{ name: "bash", input: { command: "ls -la", timeout: 5000 } }])
  })

  test("bare JSON object, fenced JSON and OpenAI function shape", () => {
    expect(TextToolCalls.parse('{"name": "bash", "parameters": {"command": "pwd"}}', names)?.calls).toEqual([
      { name: "bash", input: { command: "pwd" } },
    ])
    expect(
      TextToolCalls.parse('```json\n{"function": {"name": "read", "arguments": {"filePath": "x"}}}\n```', names)?.calls,
    ).toEqual([{ name: "read", input: { filePath: "x" } }])
  })

  test("Mistral [TOOL_CALLS] and Llama <|python_tag|>", () => {
    expect(TextToolCalls.parse('[TOOL_CALLS][{"name":"bash","arguments":{"command":"ls"}}]', names)?.calls).toEqual([
      { name: "bash", input: { command: "ls" } },
    ])
    expect(
      TextToolCalls.parse('<|python_tag|>{"name": "read", "parameters": {"filePath": "b"}}<|eom_id|>', names)?.calls,
    ).toEqual([{ name: "read", input: { filePath: "b" } }])
  })

  test("pythonic calls (Llama 3.2, Gemma tool_code)", () => {
    expect(TextToolCalls.parse('[read(filePath="a.ts"), bash(command=\'ls\', timeout=5)]', names)?.calls).toEqual([
      { name: "read", input: { filePath: "a.ts" } },
      { name: "bash", input: { command: "ls", timeout: 5 } },
    ])
    expect(TextToolCalls.parse('```tool_code\nbash(command="pwd")\n```', names)?.calls).toEqual([
      { name: "bash", input: { command: "pwd" } },
    ])
  })

  test("DeepSeek tool markers", () => {
    const text =
      '<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>bash\n```json\n{"command":"ls"}\n```<｜tool▁call▁end｜><｜tool▁calls▁end｜>'
    expect(TextToolCalls.parse(text, names)?.calls).toEqual([{ name: "bash", input: { command: "ls" } }])
  })

  test("ignores unknown tools, prose and examples inside explanations", () => {
    expect(TextToolCalls.parse('{"name": "rm_rf", "arguments": {}}', names)).toBeUndefined()
    expect(TextToolCalls.parse("Here is JSON: {\"name\": \"bash\"} in a sentence.", names)).toBeUndefined()
    expect(TextToolCalls.parse('{"name": "Ruth", "age": 1}', names)).toBeUndefined()
    expect(TextToolCalls.parse("[1, 2, 3]", names)).toBeUndefined()
    expect(TextToolCalls.parse("print(hello)", names)).toBeUndefined()
  })
})

const run = (events: LLMEvent[], tools = names) =>
  Effect.runPromise(Stream.runCollect(Stream.fromIterable(events).pipe(TextToolCalls.recover(tools)))).then((chunk) =>
    Array.from(chunk),
  )

const textBlock = (id: string, parts: string[]) => [
  LLMEvent.textStart({ id }),
  ...parts.map((text) => LLMEvent.textDelta({ id, text })),
  LLMEvent.textEnd({ id }),
]

describe("TextToolCalls.recover", () => {
  test("turns a streamed text call into a tool-call and hides it", async () => {
    const events = await run([
      ...textBlock("t", ["<tool", '_call>{"name":"bash",', '"arguments":{"command":"ls"}}</tool_call>']),
      LLMEvent.stepFinish({ index: 0, reason: { normalized: "stop" } }),
    ])
    expect(events.map((event) => event.type)).toEqual(["tool-call", "step-finish"])
    const call = events[0] as Extract<LLMEvent, { type: "tool-call" }>
    expect(call.name).toBe("bash")
    expect(call.input).toEqual({ command: "ls" })
    expect((events[1] as Extract<LLMEvent, { type: "step-finish" }>).reason.normalized).toBe("tool-calls")
  })

  test("streams prose immediately and keeps it before an inline call", async () => {
    const events = await run([
      ...textBlock("t", ["Sure, ", "reading it.\n<tool_", 'call>{"name":"read","arguments":{"filePath":"a"}}</tool_call>']),
      LLMEvent.stepFinish({ index: 0, reason: { normalized: "stop" } }),
    ])
    const text = events
      .filter((event): event is Extract<LLMEvent, { type: "text-delta" }> => event.type === "text-delta")
      .map((event) => event.text)
      .join("")
    expect(text).toBe("Sure, reading it.\n")
    expect(events[1]).toMatchObject({ type: "text-delta", text: "Sure, " })
    expect(events.some((event) => event.type === "tool-call")).toBe(true)
  })

  test("leaves plain answers and JSON answers alone", async () => {
    const plain = textBlock("t", ["Hello ", "there"])
    expect(await run([...plain])).toEqual(plain)
    const json = await run(textBlock("t", ['{"a":', " 1}"]))
    expect(json.map((event) => event.type)).toEqual(["text-start", "text-delta", "text-end"])
    expect(json[1]).toMatchObject({ text: '{"a": 1}' })
  })

  test("does nothing when the model already made native calls", async () => {
    const native = LLMEvent.toolCall({ id: "c1", name: "read", input: { filePath: "a" } })
    const events = await run([
      native,
      ...textBlock("t", ['{"name":"bash","arguments":{"command":"ls"}}']),
      LLMEvent.stepFinish({ index: 0, reason: { normalized: "tool-calls" } }),
    ])
    expect(events.filter((event) => event.type === "tool-call")).toHaveLength(1)
  })

  test("is a no-op without tools", async () => {
    const events = textBlock("t", ['{"name":"bash","arguments":{}}'])
    expect(await run(events, new Set())).toEqual(events)
  })
})
