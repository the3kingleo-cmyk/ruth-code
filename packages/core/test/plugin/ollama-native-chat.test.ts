import { afterEach, expect, test } from "bun:test"
import {
  createOllamaNativeChatFetch,
  isOllamaChatCompletionsUrl,
  ollamaNdjsonToOpenAISse,
  ollamaToOpenAIChat,
  openaiToOllamaChat,
} from "../../src/plugin/provider/ollama-native-chat"
import { resetRuthNumCtxFloor } from "@ruth/util/ruth-ctx"

afterEach(() => resetRuthNumCtxFloor())

test("detects OpenAI chat completion URLs", () => {
  expect(isOllamaChatCompletionsUrl("http://127.0.0.1:11434/v1/chat/completions")).toBe(true)
  expect(isOllamaChatCompletionsUrl("http://127.0.0.1:11434/api/tags")).toBe(false)
})

test("rewrites an OpenAI body to /api/chat with a context bucket", () => {
  const native = openaiToOllamaChat(
    {
      model: "ruth",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 16,
      temperature: 0.2,
      stream: false,
      think: false,
    },
    8192,
  )
  expect(native).toMatchObject({
    model: "ruth",
    stream: false,
    think: false,
    options: { num_ctx: 8192, num_predict: 16, temperature: 0.2, think: false },
  })
  expect(native.messages).toEqual([{ role: "user", content: "hi" }])
})

test("maps Ollama tool calls into the OpenAI shape", () => {
  const openai = ollamaToOpenAIChat(
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name: "bash", arguments: { command: "pwd" } } }],
      },
      done_reason: "stop",
      prompt_eval_count: 10,
      eval_count: 5,
    },
    "ruth",
  )
  const message = (openai.choices as Array<{ message: { tool_calls: Array<{ function: { arguments: string } }> } }>)[0]
    .message
  expect(message.tool_calls[0].function.arguments).toBe(JSON.stringify({ command: "pwd" }))
  expect((openai.choices as Array<{ finish_reason: string }>)[0].finish_reason).toBe("tool_calls")
})

test("converts an Ollama NDJSON stream into OpenAI SSE with a finish reason", async () => {
  const input = [
    JSON.stringify({ message: { role: "assistant", content: "He" }, done: false }),
    JSON.stringify({ message: { role: "assistant", content: "llo" }, done: false }),
    JSON.stringify({ message: { role: "assistant", content: "" }, done: true, done_reason: "stop", eval_count: 2 }),
  ].join("\n") + "\n"
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(input))
      controller.close()
    },
  }).pipeThrough(ollamaNdjsonToOpenAISse("ruth"))
  const text = await new Response(stream).text()
  expect(text).toContain("chat.completion.chunk")
  expect(text).toContain('"content":"He"')
  expect(text).toContain('"content":"llo"')
  expect(text).toContain('"finish_reason":"stop"')
  expect(text).toContain("data: [DONE]")
})

test("rewrites only ruth /v1 chat calls and injects num_ctx", async () => {
  const seen: Array<{ url: string; body: Record<string, unknown> }> = []
  const fetch = createOllamaNativeChatFetch(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const raw = typeof init?.body === "string" ? init.body : await new Request(input, init).text()
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    seen.push({ url, body })
    return new Response(
      JSON.stringify({
        message: { role: "assistant", content: "OK" },
        done: true,
        prompt_eval_count: 3,
        eval_count: 1,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  })
  const response = await fetch("http://127.0.0.1:11434/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "ruth", messages: [{ role: "user", content: "hi" }], stream: false }),
  })
  const json = (await response.json()) as { choices: Array<{ message: { content: string } }> }
  expect(seen).toHaveLength(1)
  expect(seen[0].url).toBe("http://127.0.0.1:11434/api/chat")
  expect(seen[0].body.options).toMatchObject({ num_ctx: 8192, think: false })
  expect(json.choices[0].message.content).toBe("OK")
})

test("keeps tool-call arguments as objects when talking to Ollama", () => {
  const native = openaiToOllamaChat(
    {
      model: "ruth",
      messages: [
        { role: "user", content: "pwd" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "bash", arguments: "{\"command\":\"pwd\"}" } }],
        },
        { role: "tool", tool_call_id: "call_1", name: "bash", content: "/tmp" },
      ],
      stream: false,
    },
    8192,
  )
  const assistant = (native.messages as Array<{ role: string; tool_calls?: Array<{ function: { arguments: unknown } }> }>).find(
    (item) => item.role === "assistant",
  )
  expect(assistant?.tool_calls?.[0]?.function.arguments).toEqual({ command: "pwd" })
})
