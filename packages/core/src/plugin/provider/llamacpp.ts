import { Effect, Schema } from "effect"
import { createLocalProviderPlugin } from "./local.js"

const providerID = "llama.cpp"

const RemoteModel = Schema.Struct({
  id: Schema.String,
  owned_by: Schema.String.pipe(Schema.optional),
  meta: Schema.NullOr(Schema.Struct({ n_ctx_train: Schema.Int.pipe(Schema.optional) })).pipe(Schema.optional),
})
const Response = Schema.Struct({ data: Schema.Array(RemoteModel) })

// `/props` reports the context the server was started with and whether a vision projector is loaded.
const Props = Schema.Struct({
  default_generation_settings: Schema.Struct({ n_ctx: Schema.Int.pipe(Schema.optional) }).pipe(Schema.optional),
  modalities: Schema.Struct({ vision: Schema.Boolean.pipe(Schema.optional) }).pipe(Schema.optional),
  chat_template: Schema.String.pipe(Schema.optional),
})

type Discovered = { readonly id: string; readonly context?: number; readonly vision?: boolean; readonly tools: boolean }

export const make = createLocalProviderPlugin({
  id: "ruth.provider.llamacpp",
  providerID,
  name: "llama.cpp",
  origin: "http://127.0.0.1:8080",
  discover: (client) =>
    Effect.gen(function* () {
      const response = yield* client.getJson("/v1/models", Response)
      // Port 8080 is popular; only claim a server that says it is llama.cpp.
      const models = response.data.filter((model) => model.owned_by === "llamacpp" && model.id.length > 0)
      if (models.length === 0) return []
      const props = yield* client.getJson("/props", Props).pipe(Effect.option)
      const settings = props._tag === "Some" ? props.value : undefined
      const context = settings?.default_generation_settings?.n_ctx
      // Native tool calls need a Jinja chat template that knows tools; otherwise Ruth describes tools in the prompt.
      const tools = settings?.chat_template === undefined ? true : /tool/i.test(settings.chat_template)
      return models.map(
        (model): Discovered => ({
          id: model.id,
          context: context ?? model.meta?.n_ctx_train,
          vision: settings?.modalities?.vision,
          tools,
        }),
      )
    }),
  model: (item) => ({ ...item, name: item.id.replace(/\.gguf$/i, "") }),
})

export const LlamaCppPlugin = make()
