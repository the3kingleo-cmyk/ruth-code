import { Effect, Schema } from "effect"
import { createLocalProviderPlugin } from "./local.js"

// Any OpenAI-compatible server the user connects with `ruth connect <url>` (Jan, LocalAI, KoboldCpp, TabbyAPI,
// text-generation-webui, a remote vLLM, ...). It has no default address, so it only runs once configured.
const RemoteModel = Schema.Struct({
  id: Schema.String,
  max_model_len: Schema.NullOr(Schema.Int).pipe(Schema.optional),
  context_length: Schema.NullOr(Schema.Int).pipe(Schema.optional),
  meta: Schema.NullOr(Schema.Struct({ n_ctx_train: Schema.Int.pipe(Schema.optional) })).pipe(Schema.optional),
})
const Response = Schema.Struct({ data: Schema.Array(RemoteModel) })

export const make = createLocalProviderPlugin({
  id: "ruth.provider.local",
  providerID: "local",
  name: "Local server",
  discover: (client) =>
    client.getJson("/v1/models", Response).pipe(
      Effect.map((response) =>
        response.data
          .filter((model) => model.id.length > 0 && !/embed|rerank|whisper|tts/i.test(model.id))
          .toSorted((a, b) => a.id.localeCompare(b.id)),
      ),
    ),
  model: (item) => ({
    id: item.id,
    // Most OpenAI-compatible servers accept tools; Ruth also recovers calls a model writes as text.
    tools: true,
    context: item.max_model_len ?? item.context_length ?? item.meta?.n_ctx_train ?? null,
  }),
})

export const OpenAILocalPlugin = make()
