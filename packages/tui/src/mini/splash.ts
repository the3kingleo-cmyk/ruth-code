// Entry and exit splash banners for direct interactive mode scrollback.
//
// The entry header is a single flex row; the exit banner uses the same plain
// ◆ ruth mark as the home screen, plus resume information. Both become immutable terminal history.
import {
  BoxRenderable,
  type ColorInput,
  TextAttributes,
  TextRenderable,
  StyledText,
  fg,
  type ScrollbackRenderContext,
  type ScrollbackSnapshot,
  type ScrollbackWriter,
} from "@opentui/core"
import { Locale } from "../util/locale"
import { stringWidth } from "../util/string-width"
import { monoTruncate } from "./mono"
import type { RunSplashTheme } from "./theme"

const SPLASH_TITLE_LIMIT = 50
const SPLASH_TITLE_FALLBACK = "Untitled session"

type SplashInput = {
  title: string | undefined
  session_id: string
  mono?: boolean
}

type SplashWriterInput = SplashInput & {
  theme: RunSplashTheme
  showSession?: boolean
}

export type SplashMeta = {
  title: string
  session_id: string
}

function title(text: string | undefined, mono = false): string {
  if (!text) {
    return SPLASH_TITLE_FALLBACK
  }

  let value = ""
  let gap = false
  for (const char of text.trim()) {
    if (char === " " || char === "\n" || char === "\r" || char === "\t") {
      gap = true
      continue
    }

    if (gap && value.length > 0) {
      value += " "
    }

    value += char
    gap = false
  }

  if (!value) {
    return SPLASH_TITLE_FALLBACK
  }

  return mono ? monoTruncate(value, SPLASH_TITLE_LIMIT, true) : Locale.truncate(value, SPLASH_TITLE_LIMIT)
}

function write(
  root: BoxRenderable,
  ctx: ScrollbackRenderContext,
  line: {
    left: number
    top: number
    text: string
    fg: ColorInput
    bg?: ColorInput
    attrs?: number
  },
): void {
  if (line.left >= ctx.width) {
    return
  }

  root.add(
    new TextRenderable(ctx.renderContext, {
      position: "absolute",
      left: line.left,
      top: line.top,
      width: Math.max(1, ctx.width - line.left),
      height: 1,
      wrapMode: "none",
      content: line.text,
      fg: line.fg,
      bg: line.bg,
      attributes: line.attrs,
    }),
  )
}

function push(
  lines: Array<{ left: number; top: number; text: string; fg: ColorInput; bg?: ColorInput; attrs?: number }>,
  left: number,
  top: number,
  text: string,
  fg: ColorInput,
  bg?: ColorInput,
  attrs?: number,
): void {
  lines.push({ left, top, text, fg, bg, attrs })
}

function buildExit(input: SplashWriterInput, ctx: ScrollbackRenderContext): ScrollbackSnapshot {
  const width = Math.max(1, ctx.width)
  const meta = splashMeta(input)
  const lines: Array<{ left: number; top: number; text: string; fg: ColorInput; bg?: ColorInput; attrs?: number }> = []
  const left = input.theme.left
  const right = input.theme.right
  const brand = input.mono ? "[ruth]" : "◆ ruth"
  const top = 1
  const body_left = stringWidth(brand) + 2
  const session = "Session  "
  const label = "Continue "
  const command = `ruth mini -s ${meta.session_id}`
  const wide = body_left + stringWidth(label + command) <= width
  const commandHeight = wide ? 1 : Math.ceil(stringWidth(command) / width)

  if (wide) {
    if (input.mono) {
      push(lines, 0, top, brand, right)
    } else {
      // Same method as the home mark: blue diamond, then bold lowercase ruth.
      push(lines, 0, top, "◆", "#5c9cf5")
      push(lines, 2, top, "ruth", right, undefined, TextAttributes.BOLD)
    }

    if (input.showSession !== false) {
      push(lines, body_left, top, session, left)
      push(lines, body_left + session.length, top, meta.title, right, undefined, TextAttributes.BOLD)
    }
    push(lines, body_left, top + 1, label, left)
  }

  const height = top + (wide ? 2 : commandHeight)
  const root = new BoxRenderable(ctx.renderContext, {
    position: "absolute",
    left: 0,
    top: 0,
    width,
    height,
  })

  for (const line of lines) {
    write(root, ctx, line)
  }
  root.add(
    new TextRenderable(ctx.renderContext, {
      position: "absolute",
      left: wide ? body_left + label.length : 0,
      top: wide ? top + 1 : top,
      width: wide ? width - body_left - label.length : width,
      height: commandHeight,
      wrapMode: "char",
      content: command,
      fg: right,
      attributes: TextAttributes.BOLD,
    }),
  )

  return {
    root,
    width,
    height,
    rowColumns: width,
    startOnNewLine: true,
    trailingNewline: false,
  }
}

export function splashMeta(input: SplashInput): SplashMeta {
  return {
    title: title(input.title, input.mono),
    session_id: input.session_id,
  }
}

export function entrySplash(input: {
  version: string
  detail?: string
  mono?: boolean
  theme: RunSplashTheme
}): ScrollbackWriter {
  return (ctx) => {
    const width = Math.max(1, ctx.width)
    const layout = entrySplashLayout({ ...input, width })
    const root = new BoxRenderable(ctx.renderContext, {
      width,
      height: 2,
      paddingTop: 1,
      flexDirection: "row",
      overflow: "hidden",
    })
    root.add(
      new TextRenderable(ctx.renderContext, {
        content: new StyledText([fg(input.theme.right)(layout.label), fg(input.theme.left)(layout.metadata)]),
        width,
        height: 1,
        wrapMode: "none",
      }),
    )
    return { root, width, height: 2, rowColumns: width, startOnNewLine: true, trailingNewline: false }
  }
}

export function entrySplashLayout(input: { width: number; version: string; detail?: string; mono?: boolean }) {
  const detail = input.detail ?? ""
  const segments = detail.split(/[/\\]/).filter(Boolean)
  const leaf = segments.at(-1) ?? detail
  const separator = input.mono ? " - " : " · "
  const ellipsis = input.mono ? "..." : "…"
  const slash = detail.includes("\\") ? "\\" : "/"
  const paths = segments
    .slice(1)
    .map((_, index) => ellipsis + slash + segments.slice(index + 1).join(slash))
    .reverse()
    .filter((path) => stringWidth(path) < stringWidth(detail))
  let layout = { label: Locale.takeWidth("ruth", input.width), version: "", path: "", metadata: "" }
  const stages = [
    { label: `${input.mono ? "[ruth]" : "◆ ruth"}` },
    ...(leaf ? [{ path: leaf }] : []),
    ...(input.version ? [{ version: input.version }] : []),
    ...paths.concat(detail ? [detail] : []).map((path) => ({ path })),
  ]
  // Stop at the first non-fitting stage instead of backfilling lower-priority metadata.
  for (const stage of stages) {
    const next = { ...layout, ...stage }
    const metadata = (next.version ? ` v${next.version}` : "") + (next.path ? separator + next.path : "")
    if (stringWidth(next.label + metadata) > input.width) break
    layout = { ...next, metadata }
  }
  return layout
}

export function exitSplash(input: SplashWriterInput): ScrollbackWriter {
  return (ctx) => buildExit(input, ctx)
}
