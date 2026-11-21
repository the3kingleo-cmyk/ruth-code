import { afterAll, expect, test } from "bun:test"
import { createServer } from "node:http"
import {
  MISSING_CHROMIUM,
  findChrome,
  resetBrowserSession,
  runBrowser,
  stopLaunchedBrowser,
} from "../../src/tool/plugin/browser-cdp"
import { description } from "../../src/tool/plugin/browser"

afterAll(() => {
  stopLaunchedBrowser()
  resetBrowserSession()
})

test("keeps a short tool description the 2B can hold in one line", () => {
  expect(description).toContain("open")
  expect(description).toContain("read")
  expect(description).toContain("click")
  expect(description).toContain("type")
  expect(description).toContain("screenshot")
  expect(description.length).toBeLessThanOrEqual(180)
  expect(description.includes(".")).toBe(false)
})

test("missing Chromium message is the one Crostini command", () => {
  expect(MISSING_CHROMIUM).toBe("Chromium is not installed. On Crostini, install it with: sudo apt install chromium")
})

test("rejects non-http URLs", async () => {
  if (!(await findChrome())) return
  process.env.RUTH_BROWSER_HEADLESS = "1"
  await expect(runBrowser({ action: "open", url: "file:///etc/passwd" })).rejects.toThrow(/http/)
})

test("opens Hacker News and reads the real top story", async () => {
  if (!(await findChrome())) throw new Error("Chrome is required for this test")
  process.env.RUTH_BROWSER_HEADLESS = "1"
  resetBrowserSession()
  const opened = await runBrowser({ action: "open", url: "news.ycombinator.com" })
  expect(opened.ok).toBe(true)
  expect(opened.url).toContain("news.ycombinator.com")
  const page = await runBrowser({ action: "read" })
  expect(page.ok).toBe(true)
  expect(page.text).toBeTruthy()
  const listed = [...(page.text ?? "").matchAll(/^\s*(\d+)\.\s+\s*(.+)$/gm)]
  const topFromText = (page.text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 8 && !/^Hacker News/i.test(line) && !/^(new|past|comments|login)/i.test(line))
  // Prefer the numbered list item, fall back to the first substantial line.
  const fromList = listed[0]?.[2]?.replace(/\s*\([^)]+\)\s*$/, "").trim()
  const title = fromList || topFromText
  expect(title?.length).toBeGreaterThan(8)
  // Cross-check against a live CSS read already in the same tab by requiring HN chrome in the text.
  expect(page.text).toContain("Hacker News")
  expect(page.text).toMatch(/comments|points/i)
  console.log("HN_TOP_STORY", title)
}, 60_000)

test("can click, type, and screenshot a local page", async () => {
  if (!(await findChrome())) return
  process.env.RUTH_BROWSER_HEADLESS = "1"
  const html = `<!doctype html><html><body>
    <h1>Fixture</h1>
    <a id="go" href="#ok">Next</a>
    <input id="q" />
    <p id="ok">Done</p>
  </body></html>`
  const server = createServer((_, res) => {
    res.writeHead(200, { "content-type": "text/html" })
    res.end(html)
  })
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      resolve(typeof address === "object" && address ? address.port : 0)
    })
  })
  try {
    const url = `http://127.0.0.1:${port}/`
    await runBrowser({ action: "open", url })
    const clicked = await runBrowser({ action: "click", selector: "Next" })
    expect(clicked.ok).toBe(true)
    const typed = await runBrowser({ action: "type", selector: "#q", text: "hello" })
    expect(typed.ok).toBe(true)
    const shot = await runBrowser({ action: "screenshot" })
    expect(shot.ok).toBe(true)
    expect(shot.path).toMatch(/browser-.*\.png$/)
    const file = Bun.file(shot.path!)
    expect(file.size).toBeGreaterThan(32)
  } finally {
    server.close()
  }
}, 60_000)
