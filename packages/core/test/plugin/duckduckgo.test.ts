import { describe, expect, test } from "bun:test"
import { parseDuckDuckGoHtml } from "../../src/plugin/websearch/duckduckgo"

describe("parseDuckDuckGoHtml", () => {
  test("reads html.duckduckgo.com result links with class before href", () => {
    const html = `
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="https://www.openstreetmap.org/">OpenStreetMap</a>
      </h2>
      <a class="result__snippet" href="https://www.openstreetmap.org/">Open map data of the world.</a>
    `
    const results = parseDuckDuckGoHtml(html)
    expect(results).toHaveLength(1)
    expect(results[0]?.url).toBe("https://www.openstreetmap.org/")
    expect(results[0]?.title).toBe("OpenStreetMap")
    expect(results[0]?.content).toContain("Open map data")
  })

  test("reads lite.duckduckgo.com result-link tags with single quotes", () => {
    const html = `
      <a rel="nofollow" href="https://capitol.wa.gov/" class='result-link'>Washington State Capitol</a>
      <td class='result-snippet'>Learn about the Washington state capitol campus.</td>
    `
    const results = parseDuckDuckGoHtml(html)
    expect(results).toHaveLength(1)
    expect(results[0]?.url).toBe("https://capitol.wa.gov/")
    expect(results[0]?.title).toBe("Washington State Capitol")
    expect(results[0]?.content).toContain("capitol campus")
  })
})
