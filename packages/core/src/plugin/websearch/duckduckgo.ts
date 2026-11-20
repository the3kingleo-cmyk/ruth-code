export * as WebSearchDuckDuckGo from "./duckduckgo.js"

import { define } from "@ruth/plugin/effect/plugin"
import { Duration, Effect } from "effect"
import { WebSearch } from "../../websearch.js"

const ENDPOINT = "https://html.duckduckgo.com/html/"

function decode(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
}

function parseResults(html: string): WebSearch.Result[] {
  const results: WebSearch.Result[] = []
  const linkRe = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)>/i
  let match: RegExpExecArray | null
  const used = new Set<string>()
  while ((match = linkRe.exec(html))) {
    let url = decode(match[1] ?? "")
    const title = decode((match[2] ?? "").replace(/<[^>]+>/g, "")).trim()
    if (url.includes("uddg=")) {
      try {
        const uddg = new URL(url, "https://duckduckgo.com").searchParams.get("uddg")
        if (uddg) url = decode(uddg)
      } catch {
        // keep url
      }
    }
    if (!url.startsWith("http") || used.has(url)) continue
    used.add(url)
    const window = html.slice(match.index, match.index + 800)
    const snippet = window.match(snippetRe)
    const content = snippet ? decode(snippet[1].replace(/<[^>]+>/g, "")).trim() : undefined
    results.push({ url, title: title || undefined, content, time: {} })
    if (results.length >= 8) break
  }
  return results
}

async function search(query: string): Promise<readonly WebSearch.Result[]> {
  const url = `${ENDPOINT}?q=${encodeURIComponent(query)}`
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`DuckDuckGo search failed (HTTP ${response.status})`)
  return parseResults(await response.text())
}

export const Plugin = define({
  id: "ruth.websearch.duckduckgo",
  effect: Effect.fn("WebSearchDuckDuckGo.Plugin")(function* (ctx) {
    const websearch = yield* WebSearch.Service
    yield* ctx.websearch.transform((editor) => {
      editor.add({
        id: WebSearch.ID.make("duckduckgo"),
        name: "DuckDuckGo",
        execute: (input) =>
          Effect.tryPromise({
            try: () => search(input.query),
            catch: (cause) => cause,
          }).pipe(
            Effect.timeoutOrElse({
              duration: Duration.seconds(16),
              orElse: () => Effect.fail(new Error("DuckDuckGo search timed out")),
            }),
          ),
      })
    })
    if (!(yield* websearch.default().pipe(Effect.orElseSucceed(() => undefined)))) {
      yield* websearch.select(WebSearch.ID.make("duckduckgo"))
    }
  }),
})
