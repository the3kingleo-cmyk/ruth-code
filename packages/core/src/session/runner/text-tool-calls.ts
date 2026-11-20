export * as TextToolCalls from "./text-tool-calls.js"

import { LLMEvent } from "@ruth/ai/effect"
import { Stream } from "effect"
import { isLocalProvider } from "../../provider.js"

/**
 * Local models without working native tool calling often write the call as text instead: Hermes/Qwen `<tool_call>`
 * blocks, Qwen-Coder `<function=…>` XML, Mistral `[TOOL_CALLS]`, Llama `<|python_tag|>` or pythonic calls, DeepSeek
 * tool markers, or a bare JSON object. This recovers those calls so the tool runs instead of the JSON landing in the
 * chat, which is the most common reason local models "don't connect" to tools.
 */
export type Call = { readonly name: string; readonly input: Record<string, unknown> }

// Prefixes that can open a text-written tool call. Text that could still grow into one is held back.
const OPENERS = [
  "<tool_call>",
  "<function=",
  "<|python_tag|>",
  "<|tool_call|>",
  "[TOOL_CALLS]",
  "<｜tool▁calls▁begin｜>",
  "<｜tool▁call▁begin｜>",
  "```",
  "{",
  "[",
]
// Markers that unambiguously start a call even after prose.
const INLINE = ["<tool_call>", "<function=", "<|python_tag|>", "<|tool_call|>", "[TOOL_CALLS]", "<｜tool▁calls▁begin｜>"]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** The first balanced JSON value at the start of `text`, if any. */
function leadingJson(text: string): { value: unknown; rest: string } | undefined {
  const start = text.search(/\S/)
  if (start === -1 || (text[start] !== "{" && text[start] !== "[")) return undefined
  let depth = 0
  let inString = false
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (inString) {
      if (char === "\\") index++
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === "{" || char === "[") depth++
    else if (char === "}" || char === "]") {
      depth--
      if (depth === 0) {
        const value = parseJson(text.slice(start, index + 1))
        return value === undefined ? undefined : { value, rest: text.slice(index + 1) }
      }
    }
  }
  return undefined
}

function toCall(value: unknown, names: ReadonlySet<string>): Call | undefined {
  if (!isRecord(value)) return undefined
  const fn = isRecord(value.function) ? value.function : value
  const name = [fn.name, fn.tool, fn.tool_name, fn.function].find((item) => typeof item === "string") as
    | string
    | undefined
  if (!name || !names.has(name)) return undefined
  const raw = fn.arguments ?? fn.parameters ?? fn.args ?? fn.input ?? fn.tool_input ?? {}
  const input = typeof raw === "string" ? parseJson(raw) : raw
  return isRecord(input) ? { name, input } : undefined
}

function jsonCalls(value: unknown, names: ReadonlySet<string>): Call[] | undefined {
  const items = Array.isArray(value) ? value : [value]
  const calls = items.map((item) => toCall(item, names))
  return calls.length > 0 && calls.every((call) => call !== undefined) ? (calls as Call[]) : undefined
}

function scalar(value: string): unknown {
  const trimmed = value.trim()
  const parsed = parseJson(trimmed)
  return parsed === undefined || typeof parsed === "string" ? value.replace(/^\n/, "").replace(/\n$/, "") : parsed
}

// `<function=name><parameter=key>value</parameter>…</function>` (Qwen3-Coder, also Hermes variants).
function xmlCalls(text: string, names: ReadonlySet<string>): Call[] {
  const calls: Call[] = []
  for (const match of text.matchAll(/<function=([\w.-]+)>([\s\S]*?)(?:<\/function>|$)/g)) {
    const name = match[1]
    if (!names.has(name)) continue
    const input: Record<string, unknown> = {}
    for (const param of match[2].matchAll(/<parameter=([\w.-]+)>([\s\S]*?)(?:<\/parameter>|(?=<parameter=)|$)/g))
      input[param[1]] = scalar(param[2])
    calls.push({ name, input })
  }
  return calls
}

// `name(key="value", n=1)` and `[a(...), b(...)]` (Llama 3.2, Gemma `tool_code`).
function pythonicCalls(text: string, names: ReadonlySet<string>): Call[] | undefined {
  const body = text.trim().replace(/^\[/, "").replace(/\]$/, "").trim()
  const calls: Call[] = []
  const pattern = /([A-Za-z_][\w.-]*)\(((?:[^()"']|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')*)\)\s*,?\s*/gy
  let consumed = 0
  for (const match of body.matchAll(pattern)) {
    if (match.index !== consumed) return undefined
    consumed = match.index + match[0].length
    if (!names.has(match[1])) return undefined
    const input: Record<string, unknown> = {}
    const args = /([A-Za-z_]\w*)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,]+)\s*,?\s*/gy
    let used = 0
    for (const arg of match[2].trim().matchAll(args)) {
      if (arg.index !== used) return undefined
      used = arg.index + arg[0].length
      const raw = arg[2].trim()
      input[arg[1]] = raw.startsWith("'")
        ? raw.slice(1, -1).replace(/\\'/g, "'")
        : (parseJson(raw) ?? (raw === "True" ? true : raw === "False" ? false : raw === "None" ? null : raw))
    }
    if (used !== match[2].trim().length) return undefined
    calls.push({ name: match[1], input })
  }
  return calls.length > 0 && consumed === body.length ? calls : undefined
}

function stripFence(text: string) {
  const fenced = /^\s*```[\w-]*\s*\n?([\s\S]*?)\n?```\s*$/.exec(text)
  return fenced ? fenced[1] : text
}

/**
 * Tool calls written as text. `prose` is what remains for the user to read. Bare JSON or pythonic calls only count
 * when they are the whole text, so an example in an explanation is never run.
 */
export function parse(text: string, names: ReadonlySet<string>): { calls: Call[]; prose: string } | undefined {
  if (names.size === 0) return undefined
  const calls: Call[] = []
  let prose = text

  // Tagged blocks: <tool_call>…</tool_call>, <|tool_call|>…<|/tool_call|>
  prose = prose.replace(
    /<\|?tool_call\|?>([\s\S]*?)(?:<\|?\/tool_call\|?>|$)/g,
    (whole, inner: string) => {
      const json = leadingJson(stripFence(inner))
      const found = json ? jsonCalls(json.value, names) : undefined
      const xml = found ? undefined : xmlCalls(inner, names)
      if (found) calls.push(...found)
      else if (xml && xml.length > 0) calls.push(...xml)
      else return whole
      return ""
    },
  )
  // Bare <function=…> XML.
  if (calls.length === 0 && prose.includes("<function=")) {
    const xml = xmlCalls(prose, names)
    if (xml.length > 0) {
      calls.push(...xml)
      prose = prose.replace(/<function=[\s\S]*?(?:<\/function>|$)/g, "")
    }
  }
  // DeepSeek: <｜tool▁call▁begin｜>function<｜tool▁sep｜>name ```json {…} ```<｜tool▁call▁end｜>
  if (calls.length === 0 && prose.includes("tool▁sep")) {
    for (const match of prose.matchAll(/<｜tool▁call▁begin｜>\w*<｜tool▁sep｜>([\w.-]+)\s*([\s\S]*?)<｜tool▁call▁end｜>/g)) {
      const input = leadingJson(stripFence(match[2]))?.value
      if (names.has(match[1]) && isRecord(input)) calls.push({ name: match[1], input })
    }
    if (calls.length > 0) prose = prose.replace(/<｜tool▁calls▁begin｜>[\s\S]*?(?:<｜tool▁calls▁end｜>|$)/g, "")
  }
  // Prefixed JSON: [TOOL_CALLS][…], <|python_tag|>{…}
  if (calls.length === 0) {
    const prefixed = /(\[TOOL_CALLS\]|<\|python_tag\|>)([\s\S]*)$/.exec(prose)
    if (prefixed) {
      const json = leadingJson(prefixed[2])
      const found = json ? jsonCalls(json.value, names) : pythonicCalls(prefixed[2].replace(/<\|eom_id\|>/g, ""), names)
      if (found) {
        calls.push(...found)
        prose = prose.slice(0, prefixed.index) + (json?.rest ?? "")
      }
    }
  }
  // The whole text is one call (or a list of calls), optionally fenced.
  if (calls.length === 0) {
    const body = stripFence(text).trim()
    const json = leadingJson(body)
    const found =
      json && json.rest.trim() === ""
        ? jsonCalls(json.value, names)
        : /^```(?:tool_code|python)?/.test(text.trim()) || /^\[?[A-Za-z_][\w.-]*\(/.test(body)
          ? pythonicCalls(body, names)
          : undefined
    if (found) {
      calls.push(...found)
      prose = ""
    }
  }
  if (calls.length === 0) return undefined
  return { calls, prose: prose.replace(/<\/?tool_call>/g, "").trim() }
}

type Held = { start?: LLMEvent; deltas: string; emitted: boolean; mode: "undecided" | "prose" | "capture"; text: string }

function couldOpen(text: string) {
  const trimmed = text.trimStart()
  if (trimmed === "") return true
  return OPENERS.some((opener) => trimmed.startsWith(opener) || opener.startsWith(trimmed))
}

/** Index where an inline marker starts, or where a partial marker at the end might start. */
function inlineCut(text: string): { at: number; partial: boolean } | undefined {
  const found = INLINE.map((marker) => text.indexOf(marker)).filter((index) => index >= 0)
  if (found.length > 0) return { at: Math.min(...found), partial: false }
  for (let length = Math.min(text.length, 24); length > 0; length--) {
    const tail = text.slice(-length)
    if (INLINE.some((marker) => marker.startsWith(tail))) return { at: text.length - length, partial: true }
  }
  return undefined
}

let counter = 0

/** Tool names a request offers, including tools inside namespaces. */
export function toolNames(tools: ReadonlyArray<unknown> | undefined): Set<string> {
  const names = new Set<string>()
  const visit = (entry: unknown) => {
    if (!isRecord(entry)) return
    if (entry.type === "namespace" && Array.isArray(entry.tools)) return entry.tools.forEach(visit)
    if (typeof entry.name === "string") names.add(entry.name)
  }
  tools?.forEach(visit)
  return names
}

/** Local servers are where text-written calls happen. `RUTH_TEXT_TOOL_CALLS=0|1` turns recovery off or on everywhere. */
export function enabled(providerID: string | undefined) {
  const flag = process.env.RUTH_TEXT_TOOL_CALLS?.toLowerCase()
  if (flag === "0" || flag === "false") return false
  if (flag === "1" || flag === "true") return true
  return isLocalProvider(providerID)
}

/**
 * Rewrites a model stream so tool calls written as text become real `tool-call` events. Prose streams through as
 * usual; only text that could be a call is held until its block ends. Native tool calls in a step disable the
 * rewrite for that step.
 */
export function recover(names: ReadonlySet<string>) {
  return <E, R>(stream: Stream.Stream<LLMEvent, E, R>): Stream.Stream<LLMEvent, E, R> => {
    if (names.size === 0) return stream
    return Stream.suspend(() => {
      const blocks = new Map<string, Held>()
      let native = false
      let pending: Call[] = []
      const handle = (event: LLMEvent): LLMEvent[] => {
        switch (event.type) {
          case "tool-input-start":
          case "tool-call":
            native = true
            return [event]
          case "text-start": {
            blocks.set(event.id, { start: event, deltas: "", emitted: false, mode: "undecided", text: "" })
            return []
          }
          case "text-delta": {
            const block = blocks.get(event.id)
            if (!block) return [event]
            block.text += event.text
            const out: LLMEvent[] = []
            const emit = (text: string) => {
              if (!block.emitted && block.start) out.push(block.start)
              block.emitted = true
              if (text) out.push(LLMEvent.textDelta({ id: event.id, text }))
            }
            if (block.mode === "capture") {
              block.deltas += event.text
              return out
            }
            block.deltas += event.text
            if (block.mode === "undecided") {
              if (couldOpen(block.deltas)) return out
              block.mode = "prose"
            }
            const cut = inlineCut(block.deltas)
            if (!cut) {
              emit(block.deltas)
              block.deltas = ""
              return out
            }
            emit(block.deltas.slice(0, cut.at))
            block.deltas = block.deltas.slice(cut.at)
            if (!cut.partial) block.mode = "capture"
            return out
          }
          case "text-end": {
            const block = blocks.get(event.id)
            blocks.delete(event.id)
            if (!block) return [event]
            const held = block.deltas
            const parsed = native || held.trim() === "" ? undefined : parse(held, names)
            const out: LLMEvent[] = []
            const visible = parsed ? parsed.prose : held
            if (!block.emitted && visible.trim() === "" && parsed) {
              // The whole block was a call: show nothing.
            } else {
              if (!block.emitted && block.start) out.push(block.start)
              if (visible) out.push(LLMEvent.textDelta({ id: event.id, text: visible }))
              const full = parsed ? block.text.slice(0, block.text.length - held.length) + visible : undefined
              out.push(parsed && event.text !== undefined ? { ...event, text: full } : event)
            }
            if (parsed) pending.push(...parsed.calls)
            return out
          }
          case "step-finish":
          case "finish": {
            if (native || pending.length === 0) {
              pending = []
              return [event]
            }
            const calls = pending.map((call) =>
              LLMEvent.toolCall({ id: `call_text_${Date.now().toString(36)}_${counter++}`, name: call.name, input: call.input }),
            )
            pending = []
            const reason = { ...event.reason, normalized: "tool-calls" as const }
            return [...calls, { ...event, reason }]
          }
          default:
            return [event]
        }
      }
      return stream.pipe(Stream.flatMap((event) => Stream.fromIterable(handle(event))))
    })
  }
}
