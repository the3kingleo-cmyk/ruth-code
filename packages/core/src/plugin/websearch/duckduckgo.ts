export * as WebSearchDuckDuckGo from "./duckduckgo.js"

import { define } from "@ruth/plugin/effect/plugin"
import { Duration, Effect } from "effect"
import { WebSearch } from "../../websearch.js"

const HTML_ENDPOINT = "https://html.duckduckgo.com/html/"
const LITE_ENDPOINT = "https://lite.duckduckgo.com/lite/"

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
}

function decode(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/<[^>]+>/g, "")
    .trim()
}

function unwrap(url: string) {
  let next = decode(url)
  if (next.includes("uddg=")) {
    try {
      const uddg = new URL(next, "https://duckduckgo.com").searchParams.get("uddg")
      if (uddg) next = decode(uddg)
    } catch {
      // keep url
    }
  }
  return next
}

function pushResult(results: WebSearch.Result[], used: Set<string>, url: string, title: string, content?: string) {
  if (!url.startsWith("http") || url.includes("duckduckgo.com") || used.has(url)) return
  used.add(url)
  results.push({ url, title: title || undefined, content: content || undefined, time: {} })
}

/** Parse either the HTML SERP (`result__a`) or the lite SERP (`result-link`). */
export function parseDuckDuckGoHtml(html: string): WebSearch.Result[] {
  const results: WebSearch.Result[] = []
  const used = new Set<string>()
  const linkRe = /<a\b([^>]*class=["'](?:result__a|result-link)["'][^>]*)>([\s\S]*?)<\/a>/gi
  const snippetRe = /class=["'](?:result__snippet|result-snippet)["'][^>]*>([\s\S]*?)<\/(?:a|td|div)>/i
  let match: RegExpExecArray | null
  while ((match = linkRe.exec(html))) {
    const href = /href=["']([^"']+)["']/i.exec(match[1] ?? "")
    if (!href) continue
    const url = unwrap(href[1] ?? "")
    const title = decode(match[2] ?? "")
    const window = html.slice(match.index, match.index + 900)
    const snippet = snippetRe.exec(window)
    pushResult(results, used, url, title, snippet ? decode(snippet[1] ?? "") : undefined)
    if (results.length >= 8) return results
  }
  return results
}

function challenged(status: number, html: string) {
  return status === 202 || /anomaly-modal/i.test(html)
}

async function fetchPage(
  url: string,
  init: { method?: string; body?: string; referer?: string; cookies: string[] },
): Promise<{ status: number; html: string; cookies: string[] }> {
  const headers: Record<string, string> = {
    ...HEADERS,
    Referer: init.referer ?? "https://html.duckduckgo.com/html/",
  }
  if (init.cookies.length > 0) headers.Cookie = init.cookies.join("; ")
  if (init.body) headers["Content-Type"] = "application/x-www-form-urlencoded"
  const response = await fetch(url, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers,
    body: init.body,
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  })
  const cookies = [...init.cookies]
  const setCookie =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : response.headers.get("set-cookie")
        ? [response.headers.get("set-cookie") as string]
        : []
  for (const raw of setCookie) {
    const first = raw.split(";", 1)[0]?.trim()
    if (first) cookies.push(first)
  }
  return { status: response.status, html: await response.text(), cookies }
}

async function tryEndpoints(query: string): Promise<readonly WebSearch.Result[]> {
  const encoded = `q=${encodeURIComponent(query)}`
  const attempts: Array<{ url: string; method: string; body?: string; referer?: string }> = [
    { url: `${HTML_ENDPOINT}?${encoded}`, method: "GET" },
    { url: HTML_ENDPOINT, method: "POST", body: encoded },
    { url: LITE_ENDPOINT, method: "POST", body: encoded, referer: "https://lite.duckduckgo.com/lite/" },
    { url: `${LITE_ENDPOINT}?${encoded}`, method: "GET", referer: "https://lite.duckduckgo.com/lite/" },
  ]
  let cookies: string[] = []
  try {
    const warm = await fetchPage(HTML_ENDPOINT, { method: "GET", cookies })
    cookies = warm.cookies
  } catch {
    // continue without a warmup
  }
  let lastError = "DuckDuckGo returned no results"
  for (const attempt of attempts) {
    for (let round = 0; round < 2; round++) {
      try {
        const page = await fetchPage(attempt.url, { ...attempt, cookies })
        cookies = page.cookies
        if (challenged(page.status, page.html)) {
          lastError = `DuckDuckGo rate-limited the search (HTTP ${page.status})`
          continue
        }
        if (!page.status || page.status >= 400) {
          lastError = `DuckDuckGo search failed (HTTP ${page.status})`
          continue
        }
        const results = parseDuckDuckGoHtml(page.html)
        if (results.length > 0) return results
        lastError = "DuckDuckGo returned no results"
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
    }
  }
  throw new Error(lastError)
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
            try: () => tryEndpoints(input.query),
            catch: (cause) => cause,
          }).pipe(
            Effect.timeoutOrElse({
              duration: Duration.seconds(20),
              orElse: () => Effect.fail(new Error("DuckDuckGo search timed out")),
            }),
          ),
      })
    })
    yield* websearch.select(WebSearch.ID.make("duckduckgo"))
  }),
})
