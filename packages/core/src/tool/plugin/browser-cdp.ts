import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { writeFile } from "node:fs/promises"
import { ensurePicturesDir, timestampedPath, which } from "../media-capture.js"

/** Shown verbatim when no Chrome/Chromium is installed and none is listening for DevTools. */
export const MISSING_CHROMIUM =
  "Chromium is not installed. On Crostini, install it with: sudo apt install chromium"

export const DEFAULT_CDP_PORT = 9222
const MAX_TEXT = 80_000
const CHROME_NAMES = [
  "google-chrome-stable",
  "google-chrome",
  "chromium",
  "chromium-browser",
  "chrome",
  "google-chrome-beta",
]

export type BrowserAction = "open" | "read" | "click" | "type" | "screenshot"

export type BrowserInput = {
  readonly action: BrowserAction
  readonly url?: string
  readonly selector?: string
  readonly text?: string
}

export type BrowserResult = {
  readonly ok: boolean
  readonly action: BrowserAction
  readonly url?: string
  readonly title?: string
  readonly text?: string
  readonly path?: string
  readonly message: string
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type CdpSocket = {
  ws: WebSocket
  nextId: number
  pending: Map<number, Pending>
}

export type BrowserSession = {
  port: number
  origin: string
  launched: boolean
  child?: ChildProcess
  page?: CdpSocket
  targetId?: string
}

let session: BrowserSession | undefined

const chromePaths = [
  process.env.RUTH_CHROME,
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/lib/chromium/chromium",
  "/snap/bin/chromium",
]

export async function findChrome(): Promise<string | undefined> {
  for (const candidate of chromePaths) {
    if (candidate && existsSync(candidate)) return candidate
  }
  for (const name of CHROME_NAMES) {
    const found = await which(name)
    if (found) return found
  }
  return undefined
}

async function probePort(port: number, timeoutMs = 800): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return false
    const json = (await response.json()) as { webSocketDebuggerUrl?: string }
    return typeof json.webSocketDebuggerUrl === "string"
  } catch {
    return false
  }
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close((error) => {
        if (error) reject(error)
        else resolve(typeof address === "object" && address ? address.port : DEFAULT_CDP_PORT)
      })
    })
    server.on("error", reject)
  })
}

function userDataDir() {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  return path.join(xdg, "ruth", "chromium")
}

function shouldUseHeadless() {
  if (process.env.RUTH_BROWSER_HEADLESS === "1" || process.env.RUTH_BROWSER_HEADLESS === "true") return true
  if (process.env.RUTH_BROWSER_HEADLESS === "0" || process.env.RUTH_BROWSER_HEADLESS === "false") return false
  return !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
}

function launchArgs(port: number, dir: string, headless: boolean, noSandbox: boolean) {
  const args = [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${dir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-dev-shm-usage",
    "--disable-popup-blocking",
    "about:blank",
  ]
  if (headless) args.unshift("--headless=new", "--disable-gpu")
  if (noSandbox) args.unshift("--no-sandbox", "--disable-setuid-sandbox")
  return args
}

async function waitForCdp(port: number, child: ChildProcess, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Chrome exited before DevTools became ready (code ${child.exitCode})`)
    }
    if (await probePort(port, 500)) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Chrome did not open DevTools on 127.0.0.1:${port}`)
}

async function spawnChrome(binary: string, port: number, noSandbox: boolean) {
  const dir = userDataDir()
  await mkdir(dir, { recursive: true })
  const args = launchArgs(port, dir, shouldUseHeadless(), noSandbox)
  const child = spawn(binary, args, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  })
  child.unref()
  try {
    await waitForCdp(port, child)
    return child
  } catch (error) {
    child.kill("SIGTERM")
    throw error
  }
}

export async function connectOrLaunch(options: { readonly port?: number } = {}): Promise<BrowserSession> {
  if (session && (await probePort(session.port))) return session
  session = undefined

  const preferred = options.port ?? Number(process.env.RUTH_CDP_PORT ?? DEFAULT_CDP_PORT)
  const candidates = [preferred, DEFAULT_CDP_PORT].filter((port, index, all) => all.indexOf(port) === index)
  for (const port of candidates) {
    if (await probePort(port)) {
      session = { port, origin: `http://127.0.0.1:${port}`, launched: false }
      return session
    }
  }

  const binary = await findChrome()
  if (!binary) throw new Error(MISSING_CHROMIUM)

  const port = (await probePort(preferred)) ? await freePort() : preferred
  let child: ChildProcess
  try {
    child = await spawnChrome(binary, port, false)
  } catch {
    child = await spawnChrome(binary, port, true)
  }
  session = { port, origin: `http://127.0.0.1:${port}`, launched: true, child }
  return session
}

async function cdpJson(origin: string, pathname: string, method: "GET" | "PUT" = "GET") {
  const response = await fetch(`${origin}${pathname}`, { method, signal: AbortSignal.timeout(10_000) })
  const text = await response.text()
  if (!response.ok) throw new Error(text || `${method} ${pathname} failed (${response.status})`)
  return text ? (JSON.parse(text) as unknown) : undefined
}

function openSocket(url: string, timeoutMs = 10_000): Promise<CdpSocket> {
  const ws = new WebSocket(url)
  const socket: CdpSocket = { ws, nextId: 0, pending: new Map() }
  ws.addEventListener("message", (event) => {
    const data = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)
    let message: { id?: number; error?: { message?: string }; result?: unknown }
    try {
      message = JSON.parse(data) as typeof message
    } catch {
      return
    }
    if (message.id === undefined) return
    const pending = socket.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    socket.pending.delete(message.id)
    if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)))
    else pending.resolve(message.result)
  })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out connecting to DevTools")), timeoutMs)
    ws.addEventListener("open", () => {
      clearTimeout(timer)
      resolve(socket)
    })
    ws.addEventListener("error", () => {
      clearTimeout(timer)
      reject(new Error("DevTools WebSocket failed"))
    })
  })
}

async function send<T = unknown>(socket: CdpSocket, method: string, params?: Record<string, unknown>, timeoutMs = 30_000) {
  const id = ++socket.nextId
  const result = new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.pending.delete(id)
      reject(new Error(`Timed out calling ${method}`))
    }, timeoutMs)
    socket.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
  })
  socket.ws.send(JSON.stringify({ id, method, params }))
  return result
}

function closeSocket(socket?: CdpSocket) {
  if (!socket) return
  for (const pending of socket.pending.values()) {
    clearTimeout(pending.timer)
    pending.reject(new Error("DevTools connection closed"))
  }
  socket.pending.clear()
  try {
    socket.ws.close()
  } catch {
    // already closed
  }
}

type Target = { id?: string; type?: string; url?: string; webSocketDebuggerUrl?: string; title?: string }

async function pageTargets(origin: string) {
  const list = (await cdpJson(origin, "/json/list")) as Target[] | undefined
  return (Array.isArray(list) ? list : []).filter(
    (item) => item.type === "page" && typeof item.webSocketDebuggerUrl === "string",
  )
}

async function attachPage(current: BrowserSession, target?: Target) {
  if (!target?.webSocketDebuggerUrl) throw new Error("No browser tab is available")
  if (current.page && current.targetId === target.id) return current.page
  closeSocket(current.page)
  const page = await openSocket(target.webSocketDebuggerUrl)
  current.page = page
  current.targetId = target.id
  await send(page, "Page.enable")
  await send(page, "Runtime.enable")
  return page
}

async function ensurePage(current: BrowserSession) {
  const pages = await pageTargets(current.origin)
  const existing = pages.find((item) => item.id === current.targetId) ?? pages[0]
  if (existing) return attachPage(current, existing)
  const created = (await cdpJson(current.origin, "/json/new?about:blank", "PUT")) as Target
  return attachPage(current, created)
}

function assertHttpUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("URL must use http:// or https://")
  if (url.username || url.password) throw new Error("URL must not include credentials")
  url.hash = ""
  return url.href
}

function normalizeUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) throw new Error("url is required for action open")
  if (/^(file|javascript|data|blob|about):/i.test(trimmed)) {
    throw new Error("URL must use http:// or https://")
  }
  return assertHttpUrl(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
}

async function waitForLoad(page: CdpSocket, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await send<{ result?: { value?: string } }>(page, "Runtime.evaluate", {
      expression: "document.readyState",
      returnByValue: true,
    })
    if (result.result?.value === "complete" || result.result?.value === "interactive") return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

async function evaluate<T>(page: CdpSocket, expression: string) {
  const result = await send<{ result?: { value?: T }; exceptionDetails?: { text?: string } }>(page, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails?.text) throw new Error(result.exceptionDetails.text)
  return result.result?.value
}

async function currentMeta(page: CdpSocket) {
  const meta = await evaluate<{ url?: string; title?: string }>(
    page,
    "({ url: location.href, title: document.title })",
  )
  return { url: meta?.url, title: meta?.title }
}

const finder = (selector: string, assign = "el") => `
(() => {
  const sel = ${JSON.stringify(selector)};
  let ${assign} = null;
  try { ${assign} = document.querySelector(sel); } catch {}
  if (!${assign} && sel) {
    const wanted = sel.trim().toLowerCase();
    ${assign} = [...document.querySelectorAll("a,button,input,textarea,select,[role='button'],[contenteditable='true']")]
      .find((node) => (node.innerText || node.getAttribute("aria-label") || node.getAttribute("placeholder") || "").trim().toLowerCase() === wanted)
      || [...document.querySelectorAll("a,button,label,span,div")].find((node) => (node.innerText || "").trim().toLowerCase() === wanted);
  }
  return ${assign};
})()
`

async function openUrl(current: BrowserSession, url: string) {
  const href = normalizeUrl(url)
  const page = await ensurePage(current)
  await send(page, "Page.navigate", { url: href })
  await waitForLoad(page)
  const meta = await currentMeta(page)
  return {
    ok: true,
    action: "open" as const,
    url: meta.url ?? href,
    title: meta.title,
    message: `Opened ${meta.title ? `${meta.title} — ` : ""}${meta.url ?? href}`,
  }
}

async function readPage(current: BrowserSession) {
  const page = await ensurePage(current)
  await waitForLoad(page)
  const meta = await currentMeta(page)
  const text = ((await evaluate<string>(page, "document.body ? document.body.innerText : ''")) ?? "").slice(0, MAX_TEXT)
  return {
    ok: true,
    action: "read" as const,
    url: meta.url,
    title: meta.title,
    text,
    message: text || "The page has no visible text.",
  }
}

async function clickPage(current: BrowserSession, selector: string) {
  if (!selector?.trim()) throw new Error("selector is required for action click")
  const page = await ensurePage(current)
  const result = await evaluate<{ ok: boolean; text?: string; error?: string }>(
    page,
    `(() => { const el = ${finder(selector.trim())}; if (!el) return { ok: false, error: "No element matched" }; el.scrollIntoView({ block: "center", inline: "center" }); el.click(); return { ok: true, text: (el.innerText || el.value || "").slice(0, 200) }; })()`,
  )
  if (!result?.ok) throw new Error(result?.error || "Click failed")
  const meta = await currentMeta(page)
  return {
    ok: true,
    action: "click" as const,
    url: meta.url,
    title: meta.title,
    message: result.text ? `Clicked “${result.text}”` : "Clicked the element",
  }
}

async function typePage(current: BrowserSession, text: string, selector?: string) {
  if (text === undefined) throw new Error("text is required for action type")
  const page = await ensurePage(current)
  if (selector?.trim()) {
    const focused = await evaluate<{ ok: boolean; error?: string }>(
      page,
      `(() => { const el = ${finder(selector.trim())}; if (!el) return { ok: false, error: "No element matched" }; el.scrollIntoView({ block: "center" }); el.focus(); if ("value" in el) el.value = ""; return { ok: true }; })()`,
    )
    if (!focused?.ok) throw new Error(focused?.error || "Could not focus the element")
  }
  await send(page, "Input.insertText", { text })
  const meta = await currentMeta(page)
  return {
    ok: true,
    action: "type" as const,
    url: meta.url,
    title: meta.title,
    message: `Typed ${text.length} character${text.length === 1 ? "" : "s"}`,
  }
}

async function screenshotPage(current: BrowserSession) {
  const page = await ensurePage(current)
  const shot = await send<{ data?: string }>(page, "Page.captureScreenshot", { format: "png" })
  if (!shot.data) throw new Error("Chrome did not return a screenshot")
  await ensurePicturesDir()
  const dest = timestampedPath("browser", ".png")
  await writeFile(dest, Buffer.from(shot.data, "base64"))
  const meta = await currentMeta(page)
  return {
    ok: true,
    action: "screenshot" as const,
    url: meta.url,
    title: meta.title,
    path: dest,
    message: `Saved screenshot to ${dest}`,
  }
}

export async function runBrowser(input: BrowserInput): Promise<BrowserResult> {
  const current = await connectOrLaunch()
  switch (input.action) {
    case "open":
      return openUrl(current, input.url ?? "")
    case "read":
      return readPage(current)
    case "click":
      return clickPage(current, input.selector ?? input.text ?? "")
    case "type":
      return typePage(current, input.text ?? "", input.selector)
    case "screenshot":
      return screenshotPage(current)
    default:
      throw new Error(`Unknown browser action: ${String(input.action)}`)
  }
}

/** Test helper: drop the cached session (does not kill a user-owned Chrome). */
export function resetBrowserSession() {
  if (!session) return
  closeSocket(session.page)
  session = undefined
}

/** Test helper: stop a Chrome we launched. Never kills a browser we only connected to. */
export function stopLaunchedBrowser() {
  const current = session
  resetBrowserSession()
  if (current?.launched && current.child?.pid) {
    try {
      process.kill(current.child.pid, "SIGTERM")
    } catch {
      // already gone
    }
  }
}
