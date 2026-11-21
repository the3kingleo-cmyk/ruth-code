/** Bucketed context lengths for the default `ruth` model on a ~6.4 GB RAM machine. */
export const RUTH_CTX_BUCKETS = [8192, 12_288, 16_384, 20_480] as const
export type RuthCtxBucket = (typeof RUTH_CTX_BUCKETS)[number]

/** Modelfile default so a request without a bucket still has a 16K window. */
export const RUTH_CTX_DEFAULT = 16_384

/** Catalog and compaction cap. Live requests pick a bucket up to this size. */
export const RUTH_CTX_MAX = 20_480

/** Tokens reserved for the model's reply when choosing a bucket. */
export const RUTH_CTX_RESERVE = 2_048

/** Catalog / compaction window for `ruth`. */
export const RUTH_NUM_CTX = RUTH_CTX_MAX

const floors = new Map<string, number>()

/** Rough token count from text. 4 characters per token is enough to pick a coarse bucket. */
export function estimateTextTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

function collectText(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    into.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, into)
    return
  }
  if (!value || typeof value !== "object") return
  const rec = value as Record<string, unknown>
  if (typeof rec.text === "string") into.push(rec.text)
  if (typeof rec.content === "string") into.push(rec.content)
  else if (rec.content !== undefined) collectText(rec.content, into)
  if (rec.tool_calls !== undefined) collectText(rec.tool_calls, into)
  if (typeof rec.arguments === "string") into.push(rec.arguments)
}

/** Estimate prompt tokens from an OpenAI-style chat body (messages, tools, optional system). */
export function estimateRequestTokens(body: {
  readonly messages?: unknown
  readonly tools?: unknown
  readonly system?: unknown
}): number {
  const parts: string[] = []
  if (typeof body.system === "string") parts.push(body.system)
  collectText(body.messages, parts)
  if (body.tools !== undefined) parts.push(JSON.stringify(body.tools))
  return estimateTextTokens(parts.join("\n"))
}

export function chooseRuthNumCtx(
  promptTokens: number,
  options?: { readonly floor?: number; readonly reserve?: number },
): RuthCtxBucket {
  const reserve = options?.reserve ?? RUTH_CTX_RESERVE
  const needed = Math.max(0, promptTokens) + Math.max(RUTH_CTX_RESERVE, reserve)
  const target = Math.max(needed, options?.floor ?? 0)
  for (const bucket of RUTH_CTX_BUCKETS) {
    if (bucket >= target) return bucket
  }
  return RUTH_CTX_MAX
}

/** A new chat is a single non-system message (plus an optional system prompt). */
export function isFreshRuthChat(messages: unknown): boolean {
  if (!Array.isArray(messages)) return true
  let count = 0
  for (const item of messages) {
    if (!item || typeof item !== "object") continue
    if ((item as { role?: unknown }).role === "system") continue
    count++
  }
  return count <= 1
}

/**
 * Pick a context bucket for this request. Mid-conversation the size never shrinks
 * (changing `num_ctx` reloads the model). A fresh short chat may step back down.
 */
export function nextRuthNumCtx(
  body: {
    readonly messages?: unknown
    readonly tools?: unknown
    readonly system?: unknown
    readonly max_tokens?: unknown
    readonly max_completion_tokens?: unknown
  },
  key = "ruth",
): RuthCtxBucket {
  const listed = Number(body.max_tokens ?? body.max_completion_tokens ?? 0)
  const reserve = Number.isFinite(listed) && listed > 0 ? listed : RUTH_CTX_RESERVE
  const fresh = isFreshRuthChat(body.messages)
  const floor = fresh ? undefined : floors.get(key)
  const chosen = chooseRuthNumCtx(estimateRequestTokens(body), { floor, reserve })
  floors.set(key, chosen)
  return chosen
}

export function resetRuthNumCtxFloor(key?: string): void {
  if (key) floors.delete(key)
  else floors.clear()
}
