/**
 * Ollama's OpenAI-compatible `/v1/chat/completions` ignores `options.num_ctx`.
 * This fetch wrapper rewrites `ruth` chat calls to native `/api/chat` so a
 * per-request context bucket is honored, then maps the response back to OpenAI shape.
 */
import { nextRuthNumCtx, resetRuthNumCtxFloor } from "@ruth/util/ruth-ctx"

export { resetRuthNumCtxFloor }

const CHAT_PATH = /\/(?:v1\/)?chat\/completions\/?$/

export function isOllamaChatCompletionsUrl(url: string): boolean {
  try {
    return CHAT_PATH.test(new URL(url).pathname)
  } catch {
    return false
  }
}

export function isRuthModel(model: unknown): boolean {
  if (typeof model !== "string") return false
  const bare = model.endsWith(":latest") ? model.slice(0, -":latest".length) : model
  return bare === "ruth"
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function imageBase64(url: unknown): string | undefined {
  if (typeof url !== "string" || url.length === 0) return undefined
  const match = /^data:[^;]+;base64,(.+)$/s.exec(url)
  return match?.[1] ?? (url.startsWith("http") ? undefined : url)
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return content == null ? "" : String(content)
  const parts: string[] = []
  for (const part of content) {
    const rec = asRecord(part)
    if (!rec) continue
    if (typeof rec.text === "string") parts.push(rec.text)
  }
  return parts.join("\n")
}

function contentImages(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  const images: string[] = []
  for (const part of content) {
    const rec = asRecord(part)
    if (!rec) continue
    const url = asRecord(rec.image_url)?.url ?? rec.url
    const data = imageBase64(url)
    if (data) images.push(data)
  }
  return images
}

function toolCallArguments(value: unknown): string {
  if (typeof value === "string") return value
  if (value == null) return "{}"
  try {
    return JSON.stringify(value)
  } catch {
    return "{}"
  }
}

function toolCallArgumentsObject(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  if (value == null) return {}
  return value
}

function mapToolCalls(value: unknown, argumentsStyle: "string" | "object"): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  return value.map((item, index) => {
    const rec = asRecord(item) ?? {}
    const fn = asRecord(rec.function) ?? rec
    const name = typeof fn.name === "string" ? fn.name : typeof rec.name === "string" ? rec.name : "tool"
    const args = fn.arguments ?? rec.arguments ?? rec.input
    const id = typeof rec.id === "string" && rec.id ? rec.id : `call_${index}`
    return {
      id,
      type: "function",
      function: { name, arguments: argumentsStyle === "object" ? toolCallArgumentsObject(args) : toolCallArguments(args) },
    }
  })
}

export function openaiToOllamaMessages(messages: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(messages)) return []
  const out: Array<Record<string, unknown>> = []
  for (const item of messages) {
    const rec = asRecord(item)
    if (!rec) continue
    const role = typeof rec.role === "string" ? rec.role : "user"
    const message: Record<string, unknown> = { role, content: contentText(rec.content) }
    const images = contentImages(rec.content)
    if (images.length > 0) message.images = images
    const toolCalls = mapToolCalls(rec.tool_calls, "object")
    if (toolCalls) message.tool_calls = toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: call.function,
    }))
    if (typeof rec.tool_call_id === "string") message.tool_call_id = rec.tool_call_id
    if (typeof rec.name === "string" && role === "tool") message.tool_name = rec.name
    out.push(message)
  }
  return out
}

export function openaiToOllamaChat(body: Record<string, unknown>, numCtx?: number): Record<string, unknown> {
  const optionsIn = asRecord(body.options) ?? {}
  const maxTokens = Number(body.max_tokens ?? body.max_completion_tokens)
  const temperature = body.temperature ?? optionsIn.temperature
  const topP = body.top_p ?? optionsIn.top_p
  const topK = body.top_k ?? optionsIn.top_k
  const seed = body.seed ?? optionsIn.seed
  const stop = body.stop ?? optionsIn.stop
  const options: Record<string, unknown> = { ...optionsIn, think: false }
  if (numCtx !== undefined) options.num_ctx = numCtx
  if (Number.isFinite(maxTokens) && maxTokens > 0) options.num_predict = maxTokens
  if (temperature !== undefined) options.temperature = temperature
  if (topP !== undefined) options.top_p = topP
  if (topK !== undefined) options.top_k = topK
  if (seed !== undefined) options.seed = seed
  if (stop !== undefined) options.stop = stop

  const think = body.think === true ? true : false
  const request: Record<string, unknown> = {
    model: body.model,
    messages: openaiToOllamaMessages(body.messages),
    stream: Boolean(body.stream),
    think,
    options,
  }
  if (Array.isArray(body.tools) && body.tools.length > 0) request.tools = body.tools
  if (body.tool_choice !== undefined) request.tool_choice = body.tool_choice
  return request
}

function finishReason(doneReason: unknown, hasTools: boolean): string {
  if (hasTools) return "tool_calls"
  if (doneReason === "length" || doneReason === "max_tokens") return "length"
  return "stop"
}

export function ollamaToOpenAIChat(payload: Record<string, unknown>, model: string): Record<string, unknown> {
  const message = asRecord(payload.message) ?? {}
  const toolCalls = mapToolCalls(message.tool_calls, "string")
  const content = typeof message.content === "string" ? message.content : ""
  const prompt = Number(payload.prompt_eval_count ?? 0)
  const completion = Number(payload.eval_count ?? 0)
  return {
    id: `chatcmpl-ruth`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: toolCalls ? content || null : content,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason(payload.done_reason, Boolean(toolCalls)),
      },
    ],
    usage: {
      prompt_tokens: Number.isFinite(prompt) ? prompt : 0,
      completion_tokens: Number.isFinite(completion) ? completion : 0,
      total_tokens: (Number.isFinite(prompt) ? prompt : 0) + (Number.isFinite(completion) ? completion : 0),
    },
  }
}

function chunk(model: string, delta: Record<string, unknown>, finish?: string, usage?: Record<string, unknown>) {
  return {
    id: "chatcmpl-ruth",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finish ?? null,
      },
    ],
    ...(usage ? { usage } : {}),
  }
}

function sse(data: unknown): string {
  return `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`
}

/** Convert Ollama NDJSON chat stream bytes into OpenAI SSE `data:` frames. */
export function ollamaNdjsonToOpenAISse(model: string): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let pending = ""
  let roleSent = false
  let emittedTools = false
  let lastFinish: string | undefined
  return new TransformStream({
    transform(part, controller) {
      pending += decoder.decode(part, { stream: true })
      const lines = pending.split("\n")
      pending = lines.pop() ?? ""
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let payload: Record<string, unknown>
        try {
          payload = JSON.parse(trimmed) as Record<string, unknown>
        } catch {
          continue
        }
        if (typeof payload.error === "string") {
          controller.enqueue(
            encoder.encode(sse({ error: { message: payload.error, type: "invalid_request_error" } })),
          )
          continue
        }
        const message = asRecord(payload.message) ?? {}
        const delta: Record<string, unknown> = {}
        if (!roleSent) {
          delta.role = "assistant"
          roleSent = true
        }
        if (typeof message.content === "string" && message.content.length > 0) delta.content = message.content
        const toolCalls = mapToolCalls(message.tool_calls, "string")
        if (toolCalls) {
          emittedTools = true
          delta.tool_calls = toolCalls.map((call, index) => ({
            index,
            id: call.id,
            type: "function",
            function: call.function,
          }))
        }
        if (Object.keys(delta).length > 0) controller.enqueue(encoder.encode(sse(chunk(model, delta))))
        if (payload.done === true) {
          const prompt = Number(payload.prompt_eval_count ?? 0)
          const completion = Number(payload.eval_count ?? 0)
          lastFinish = finishReason(payload.done_reason, emittedTools)
          controller.enqueue(
            encoder.encode(
              sse(
                chunk(
                  model,
                  {},
                  lastFinish,
                  {
                    prompt_tokens: Number.isFinite(prompt) ? prompt : 0,
                    completion_tokens: Number.isFinite(completion) ? completion : 0,
                    total_tokens:
                      (Number.isFinite(prompt) ? prompt : 0) + (Number.isFinite(completion) ? completion : 0),
                  },
                ),
              ),
            ),
          )
        }
      }
    },
    flush(controller) {
      if (pending.trim()) {
        try {
          const payload = JSON.parse(pending.trim()) as Record<string, unknown>
          if (payload.done === true && !lastFinish) {
            lastFinish = finishReason(payload.done_reason, emittedTools)
            controller.enqueue(encoder.encode(sse(chunk(model, {}, lastFinish))))
          }
        } catch {
          // drop a trailing partial line
        }
      }
      if (!lastFinish) controller.enqueue(encoder.encode(sse(chunk(model, {}, emittedTools ? "tool_calls" : "stop"))))
      controller.enqueue(encoder.encode(sse("[DONE]")))
    },
  })
}

function headersWith(source: Headers, contentType: string): Headers {
  const headers = new Headers(source)
  headers.set("content-type", contentType)
  headers.delete("content-length")
  headers.delete("transfer-encoding")
  return headers
}

export function createOllamaNativeChatFetch(baseFetch: typeof fetch = globalThis.fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request && init === undefined ? input.clone() : new Request(input, init)
    if (request.method.toUpperCase() !== "POST" || !isOllamaChatCompletionsUrl(request.url)) {
      return baseFetch(input as RequestInfo, init)
    }
    let body: Record<string, unknown>
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return baseFetch(input as RequestInfo, init)
    }
    if (!isRuthModel(body.model)) return baseFetch(input as RequestInfo, init)

    const numCtx = nextRuthNumCtx(body)
    const native = openaiToOllamaChat(body, numCtx)
    const url = new URL(request.url)
    const target = `${url.origin}/api/chat`
    const headers = new Headers(request.headers)
    headers.set("content-type", "application/json")
    headers.delete("content-length")
    const response = await baseFetch(target, {
      method: "POST",
      headers,
      body: JSON.stringify(native),
      signal: request.signal,
    })
    if (!response.ok) {
      const text = await response.text()
      let message = text
      try {
        const parsed = JSON.parse(text) as { error?: unknown }
        if (typeof parsed.error === "string") message = parsed.error
        else if (parsed.error && typeof parsed.error === "object" && "message" in parsed.error) {
          message = String((parsed.error as { message: unknown }).message)
        }
      } catch {
        // keep raw text
      }
      return new Response(JSON.stringify({ error: { message, type: "invalid_request_error" } }), {
        status: response.status,
        headers: { "content-type": "application/json" },
      })
    }
    if (native.stream) {
      const stream = response.body ? response.body.pipeThrough(ollamaNdjsonToOpenAISse(String(body.model))) : null
      return new Response(stream, {
        status: 200,
        headers: headersWith(response.headers, "text/event-stream"),
      })
    }
    const payload = (await response.json()) as Record<string, unknown>
    return new Response(JSON.stringify(ollamaToOpenAIChat(payload, String(body.model))), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
}

export const ollamaNativeChatFetch = createOllamaNativeChatFetch()
