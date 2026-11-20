import { Effect } from "effect"
import { define } from "@ruth/plugin/effect/plugin"

export const KiloPlugin = define({
  id: "ruth.provider.kilo",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.provider.transform((evt) => {
      for (const item of evt.list()) {
        if (item.provider.package !== "@ruth/ai/providers/openai-compatible") continue
        if (item.provider.settings?.baseURL !== "https://api.kilo.ai/api/gateway") continue
        evt.update(item.provider.id, (provider) => {
          provider.headers = { ...provider.headers, "HTTP-Referer": "", "X-Title": "ruth" }
        })
      }
    })
  }),
})
