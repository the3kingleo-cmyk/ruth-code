export * as ScreenshotTool from "./screenshot.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { toolFailure } from "../runtime.js"
import { Permission } from "../../permission.js"
import { ensurePicturesDir, fileReady, run, timestampedPath, which } from "../media-capture.js"

export const name = "screenshot"

export const description = [
  "Capture a screenshot of the screen (or the current terminal window when possible) and save it under ~/Pictures/ruth.",
  "Use this when the user asks to take a screenshot, capture the screen, or show what's on screen.",
  "Returns the saved file path. If no capture tool is available, explains what was tried.",
].join("\n")

export const Input = Schema.Struct({
  target: Schema.optionalKey(Schema.Literals(["screen", "terminal"])).annotate({
    description: 'What to capture. Defaults to "screen". "terminal" captures the current terminal window when a window id is available, otherwise the full screen.',
  }),
})

export const Output = Schema.Struct({
  path: Schema.String.annotate({ description: "Absolute path of the saved PNG" }),
  target: Schema.String,
  tool: Schema.String.annotate({ description: "Capture command that succeeded" }),
})

async function capture(target: "screen" | "terminal") {
  await ensurePicturesDir()
  const dest = timestampedPath("screenshot", ".png")
  const tried: string[] = []
  const display = process.env.DISPLAY
  const wayland = process.env.WAYLAND_DISPLAY
  const windowId = process.env.WINDOWID

  const attempts: Array<{ bin: string; args: string[]; need?: string; label: string }> = []
  if (target === "terminal" && windowId) {
    attempts.push({ bin: "import", args: ["-window", windowId, dest], need: display, label: "import -window" })
    attempts.push({
      bin: "gnome-screenshot",
      args: ["-w", "-f", dest],
      label: "gnome-screenshot -w",
    })
  }
  attempts.push({ bin: "grim", args: [dest], need: wayland, label: "grim" })
  attempts.push({ bin: "gnome-screenshot", args: ["-f", dest], label: "gnome-screenshot" })
  attempts.push({ bin: "import", args: ["-window", "root", dest], need: display, label: "import -window root" })
  attempts.push({ bin: "scrot", args: [dest], label: "scrot" })
  attempts.push({ bin: "xfce4-screenshooter", args: ["-f", "-s", dest], label: "xfce4-screenshooter" })
  attempts.push({ bin: "spectacle", args: ["-b", "-n", "-o", dest], label: "spectacle" })

  for (const attempt of attempts) {
    if (attempt.need === "") continue
    const resolved = await which(attempt.bin)
    if (!resolved) {
      tried.push(`${attempt.label} (not installed)`)
      continue
    }
    try {
      await run(resolved, attempt.args)
      await fileReady(dest)
      return { path: dest, target, tool: attempt.label }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      tried.push(`${attempt.label}: ${message.slice(0, 160)}`)
    }
  }

  throw new Error(
    `Could not capture a screenshot. Tried: ${tried.join("; ") || "no capture tools found"}. On Crostini, install one of: grim, gnome-screenshot, or ImageMagick (import).`,
  )
}

export const Plugin = {
  id: "opencode.tool.screenshot",
  effect: Effect.fn("ScreenshotTool.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const target = input.target ?? "screen"
              yield* permission.assert({
                action: name,
                resources: [target],
                save: ["*"],
                metadata: { target },
                ...Permission.invocation(context),
              }).pipe(
                Effect.mapError((error) => new ToolFailure({ message: "Unable to capture a screenshot", error })),
              )
              return yield* Effect.tryPromise({
                try: () => capture(target),
                catch: (error) =>
                  new ToolFailure({
                    message: error instanceof Error ? error.message : String(error),
                  }),
              }).pipe(
                Effect.map((result) => ({
                  output: result,
                  content: `Screenshot saved to ${result.path}`,
                  metadata: result,
                })),
                Effect.mapError(toolFailure("Unable to capture a screenshot")),
              )
            }),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
