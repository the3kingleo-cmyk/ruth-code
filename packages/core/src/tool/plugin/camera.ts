export * as CameraTool from "./camera.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { promises as fs } from "node:fs"
import { toolFailure } from "../runtime.js"
import { Permission } from "../../permission.js"
import { ensurePicturesDir, fileReady, run, timestampedPath, which } from "../media-capture.js"

export const name = "camera"
const DEFAULT_DEVICE = "/dev/video0"

export const description = [
  "Take a photo from the webcam and save it under ~/Pictures/ruth.",
  "Uses ffmpeg with V4L2 (default device /dev/video0) when available.",
  "Use this when the user asks to take a photo, use the camera, or capture from the webcam.",
  "Returns the saved file path, or a clear message if the camera or ffmpeg is unavailable.",
].join("\n")

export const Input = Schema.Struct({
  device: Schema.optionalKey(Schema.String).annotate({
    description: "V4L2 device path. Defaults to /dev/video0.",
  }),
})

export const Output = Schema.Struct({
  path: Schema.String.annotate({ description: "Absolute path of the saved JPEG" }),
  device: Schema.String,
})

async function snap(device: string) {
  const ffmpeg = await which("ffmpeg")
  if (!ffmpeg) {
    throw new Error("ffmpeg is not installed. The Ruth installer can install it, or run: sudo apt-get install -y ffmpeg")
  }
  try {
    await fs.access(device)
  } catch {
    throw new Error(`No webcam found at ${device}. Plug in a camera or pass a different device path.`)
  }
  await ensurePicturesDir()
  const dest = timestampedPath("camera", ".jpg")
  try {
    await run(
      ffmpeg,
      ["-hide_banner", "-loglevel", "error", "-y", "-f", "v4l2", "-i", device, "-frames:v", "1", "-q:v", "2", dest],
      { timeout: 20_000 },
    )
    await fileReady(dest)
    return { path: dest, device }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not capture from ${device}: ${message.slice(0, 240)}`)
  }
}

export const Plugin = {
  id: "opencode.tool.camera",
  effect: Effect.fn("CameraTool.Plugin")(function* (ctx: Context) {
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
              const device = input.device?.trim() || DEFAULT_DEVICE
              yield* permission.assert({
                action: name,
                resources: [device],
                save: ["*"],
                metadata: { device },
                ...Permission.invocation(context),
              }).pipe(
                Effect.mapError((error) => new ToolFailure({ message: "Unable to capture a photo", error })),
              )
              return yield* Effect.tryPromise({
                try: () => snap(device),
                catch: (error) =>
                  new ToolFailure({
                    message: error instanceof Error ? error.message : String(error),
                  }),
              }).pipe(
                Effect.map((result) => ({
                  output: result,
                  content: `Photo saved to ${result.path}`,
                  metadata: result,
                })),
                Effect.mapError(toolFailure("Unable to capture a photo")),
              )
            }),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
