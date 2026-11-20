import { LLMEvent, LLMResponse } from "./schema/index.js"

export interface ExtractedToolCall {
  readonly name: string
  readonly arguments: Record<string, unknown>
}

const NAME_KEYS = ["name", "tool", "tool_name"] as const
const ARG_KEYS = ["arguments", "parameters", "input", "args"] as const

function toolName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  const rec = value as Record<string, unknown>
  for (const key of NAME_KEYS) {
    if (typeof rec[key] === "string" && rec[key].trim().length > 0) return rec[key].trim()
  }
  return undefined
}

function toolArgs(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined
  const rec = value as Record<string, unknown>
  for (const key of ARG_KEYS) {
    const raw = rec[key]
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
      } catch {
        return undefined
      }
    }
  }
  // Flattened calls such as {"name":"write","path":"hello.txt","content":"hi"}
  const rest: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(rec)) {
    if ((NAME_KEYS as readonly string[]).includes(key)) continue
    if ((ARG_KEYS as readonly string[]).includes(key)) continue
    rest[key] = item
  }
  if (Object.keys(rest).length > 0) return rest
  return undefined
}

/** Walk text for JSON objects, including fenced ```json blocks. Conservative: no eval, brace matching only. */
export function findJsonObjects(text: string): unknown[] {
  const objects: unknown[] = []
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
  const sources = fences.length > 0 ? fences.map((m) => m[1]) : [text]
  for (const source of sources) {
    for (let i = 0; i < source.length; i++) {
      if (source[i] !== "{") continue
      let depth = 0
      let inString = false
      let escape = false
      for (let j = i; j < source.length; j++) {
        const ch = source[j]
        if (inString) {
          if (escape) escape = false
          else if (ch === "\\") escape = true
          else if (ch === '"') inString = false
          continue
        }
        if (ch === '"') inString = true
        else if (ch === "{") depth++
        else if (ch === "}") {
          depth--
          if (depth === 0) {
            try {
              objects.push(JSON.parse(source.slice(i, j + 1)))
            } catch {
              // skip invalid slice
            }
            i = j
            break
          }
        }
      }
    }
  }
  return objects
}

/**
 * Lift a single tool-call JSON object out of assistant text when the name is a
 * registered tool. Returns undefined unless exactly one matching object is found.
 */
export function extractToolCallFromText(text: string, registeredNames: ReadonlySet<string>): ExtractedToolCall | undefined {
  if (!text || registeredNames.size === 0) return undefined
  const matches: ExtractedToolCall[] = []
  for (const obj of findJsonObjects(text)) {
    const name = toolName(obj)
    if (!name || !registeredNames.has(name)) continue
    const args = toolArgs(obj)
    if (!args) continue
    matches.push({ name, arguments: args })
  }
  if (matches.length !== 1) return undefined
  return matches[0]
}

export function toolNamesFrom(tools: ReadonlyArray<{ readonly name: string }> | undefined): Set<string> {
  return new Set((tools ?? []).map((tool) => tool.name).filter(Boolean))
}

/**
 * If the model wrote a single registered tool-call JSON object in its text and
 * emitted no native tool calls, attach a synthetic tool-call event.
 */
export function withTextToolCalls(
  response: LLMResponse,
  registeredNames: ReadonlySet<string>,
): LLMResponse {
  if (response.toolCalls.length > 0) return response
  const extracted = extractToolCallFromText(response.text, registeredNames)
  if (!extracted) return response
  const event = LLMEvent.toolCall({
    id: `text-tool-${extracted.name}`,
    name: extracted.name,
    input: extracted.arguments,
  })
  const events = [...response.events]
  const finishAt = events.findLastIndex((item) => item.type === "finish")
  if (finishAt === -1) events.push(event)
  else events.splice(finishAt, 0, event)
  return LLMResponse.fromEvents(events) ?? new LLMResponse({ ...response, events })
}
