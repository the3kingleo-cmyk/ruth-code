#!/usr/bin/env bun
/**
 * Small-model smoke test against a local Ollama instance.
 * Uses huihui_ai/qwen3-abliterated:1.7b (or $JCODE_SMOKE_MODEL) on a few tool-using prompts.
 * Reports native tool-call presence (typical "before" behavior of a small model)
 * and whether the Jarvis Code text extractor can lift a {name, arguments} object ("after").
 */
import { extractToolCallFromText } from "../packages/ai/src/tool-call-extract.ts"

const host = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434"
const model = process.env.JCODE_SMOKE_MODEL ?? process.env.OPENCODE_SMOKE_MODEL ?? "huihui_ai/qwen3-abliterated:1.7b"
const tools = [
  {
    type: "function",
    function: {
      name: "read",
      description: "Read a file",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  },
]

const prompts = [
  'Call the read tool on path "README.md". If you cannot emit a native tool call, reply with only this JSON: {"name":"read","arguments":{"path":"README.md"}}',
  "What is 2+2? Reply with a short sentence. Do not call a tool.",
]

async function chat(prompt: string) {
  const body = {
    model,
    stream: false,
    tools,
    messages: [
      { role: "system", content: "You are a brief coding assistant. Use tools when asked." },
      { role: "user", content: prompt },
    ],
  }
  const res = await fetch(`${host}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`)
  return res.json()
}

const names = new Set(["read"])
const results: unknown[] = []
for (const prompt of prompts) {
  const started = Date.now()
  const json = await chat(prompt)
  const choice = json.choices?.[0]?.message ?? {}
  const text = String(choice.content ?? "")
  const native = Array.isArray(choice.tool_calls) ? choice.tool_calls : []
  const extracted = extractToolCallFromText(text, names)
  const row = {
    prompt: prompt.slice(0, 80),
    ms: Date.now() - started,
    nativeToolCalls: native.length,
    extracted,
    textPreview: text.replace(/\s+/g, " ").slice(0, 160),
  }
  results.push(row)
  console.log(JSON.stringify(row, null, 2))
}

const toolPrompt = results[0] as { nativeToolCalls: number; extracted?: { name: string } }
const chatPrompt = results[1] as { textPreview: string }
if (!toolPrompt.nativeToolCalls && !toolPrompt.extracted) {
  console.error("FAIL: small model produced neither a native tool call nor extractable JSON for the tool prompt")
  process.exit(2)
}
if (toolPrompt.extracted && toolPrompt.extracted.name !== "read") {
  console.error("FAIL: extractor returned a non-read tool")
  process.exit(2)
}
console.log(
  `SMOKE_OK model=${model} native=${toolPrompt.nativeToolCalls} extracted=${toolPrompt.extracted ? "yes" : "no"} chat_preview=${JSON.stringify(chatPrompt.textPreview)}`,
)
