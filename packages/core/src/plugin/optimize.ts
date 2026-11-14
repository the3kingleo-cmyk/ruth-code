export * as OptimizePlugin from "./optimize.js"

import { define, type Context } from "@ruth/plugin/effect/plugin"
import type { SessionHooks } from "@ruth/plugin/effect/session"
import { Model } from "@ruth/schema/model"
import { Effect } from "effect"
import { SessionSystemPrompt } from "../session/system-prompt.js"

import PROMPT_LOCAL from "./system-prompt/local.txt"

/** Providers that serve models from the user's own machine. */
const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio", "llamacpp", "llama.cpp"])

/** True for small models served locally, including Ruth's own `ruth` Ollama model. */
export function isLocalModel(model: Pick<Model.Info, "providerID" | "id">) {
  return LOCAL_PROVIDERS.has(model.providerID.toLowerCase()) || model.id.toLowerCase().startsWith("ruth")
}

/** Every provider shares Ruth's one system prompt; small local models get a short extra note appended. */
export const LocalModelPlugin = define({
  id: "ruth.prompt.local",
  effect: Effect.fn("OptimizePlugin.local")(function* (ctx) {
    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const model = yield* resolveModel(ctx, event)
        if (!isLocalModel(model)) return
        if ((yield* ctx.agent.get({ agentID: event.agent })).data.system) return
        const system = event.system[0]
        if (!system) return
        const note = SessionSystemPrompt.render(PROMPT_LOCAL, Object.keys(event.tools))
        event.system[0] = { ...system, text: `${system.text}\n\n${note}` }
      }).pipe(Effect.catch(() => Effect.void))
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
})

export const Plugins = [LocalModelPlugin] as const

const models = new WeakMap<SessionHooks["context"], Model.Info>()

export const resolveModel = (ctx: Context, event: SessionHooks["context"]) =>
  Effect.gen(function* () {
    const cached = models.get(event)
    if (cached?.providerID === event.model.providerID && cached.id === event.model.id) return cached
    const model: Model.Info =
      (yield* ctx.model.list()).data.find(
        (model) => model.providerID === event.model.providerID && model.id === event.model.id,
      ) ?? Model.Info.default(event.model.providerID, event.model.id)
    models.set(event, model)
    return model
  })
