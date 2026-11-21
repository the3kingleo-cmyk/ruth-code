export * as BrowserTool from "./browser.js"

import { ToolFailure } from "@ruth/ai/effect"
import type { Context } from "@ruth/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Permission } from "../../permission.js"
import { MISSING_CHROMIUM, runBrowser, type BrowserAction } from "./browser-cdp.js"

export const name = "browser"

export const description =
  "Control the local Chrome/Chromium browser: action open (url), read (page text), click (selector or visible text), type (text, optional selector), or screenshot"

export const Input = Schema.Struct({
  action: Schema.Literals(["open", "read", "click", "type", "screenshot"]).annotate({
    description: "open, read, click, type, or screenshot",
  }),
  url: Schema.optionalKey(Schema.String).annotate({ description: "URL for action open" }),
  selector: Schema.optionalKey(Schema.String).annotate({
    description: "CSS selector or visible text for click, and optional field for type",
  }),
  text: Schema.optionalKey(Schema.String).annotate({ description: "Text to type" }),
})

export const Output = Schema.Struct({
  ok: Schema.Boolean,
  action: Schema.Literals(["open", "read", "click", "type", "screenshot"]),
  url: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
  message: Schema.String,
})

export const Plugin = {
  id: "ruth.tool.browser",
  effect: Effect.fn("BrowserTool.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { permission: "browser", codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const action = input.action as BrowserAction
              if (action === "open") {
                const raw = (input.url ?? "").trim()
                const url = /^https?:\/\//i.test(raw) ? raw.split("#")[0] : `https://${raw}`.split("#")[0]
                yield* permission.assert({
                  action: name,
                  resources: [url],
                  save: ["*"],
                  metadata: input,
                  ...Permission.invocation(context),
                })
              }
              const result = yield* Effect.tryPromise({
                try: () => runBrowser({ action, url: input.url, selector: input.selector, text: input.text }),
                catch: (error) => (error instanceof Error ? error : new Error(String(error))),
              })
              return {
                output: result,
                content: result.action === "read" ? (result.text ?? result.message) : result.message,
                metadata: { url: result.url, path: result.path },
              }
            }).pipe(
              Effect.mapError((error) => {
                const message = error instanceof Error ? error.message : String(error)
                if (message.includes("sudo apt install chromium")) return new ToolFailure({ message: MISSING_CHROMIUM })
                return new ToolFailure({ message: message || "Browser action failed", error })
              }),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
