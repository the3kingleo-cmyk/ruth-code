import { Effect, Schema } from "effect"
import { createLocalProviderPlugin } from "./local.js"

const RemoteModel = Schema.Struct({
  type: Schema.String,
  key: Schema.String,
  display_name: Schema.String,
  architecture: Schema.NullOr(Schema.String).pipe(Schema.optional),
  loaded_instances: Schema.Array(
    Schema.Struct({
      config: Schema.Struct({ context_length: Schema.Int }),
    }),
  ),
  // Null for decision models whose context is unknown.
  max_context_length: Schema.NullOr(Schema.Int),
  capabilities: Schema.Struct({
    vision: Schema.Boolean,
    trained_for_tool_use: Schema.Boolean,
  }).pipe(Schema.optional),
  has_vision_adapter: Schema.Boolean.pipe(Schema.optional),
})

const Response = Schema.Struct({ models: Schema.Array(RemoteModel) })

// LM Studio before 0.3.16 has only the beta REST API.
const BetaModel = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  arch: Schema.String.pipe(Schema.optional),
  max_context_length: Schema.Int.pipe(Schema.optional),
  loaded_context_length: Schema.Int.pipe(Schema.optional),
  capabilities: Schema.Array(Schema.String).pipe(Schema.optional),
})
const BetaResponse = Schema.Struct({ data: Schema.Array(BetaModel) })
// Any build still serves the OpenAI-compatible list.
const OpenAIResponse = Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) })

type Discovered = {
  readonly key: string
  readonly name?: string
  readonly family?: string | null
  readonly type: "chat" | "decision"
  readonly tools?: boolean
  readonly vision?: boolean
  readonly context?: number | null
}

const current = (model: typeof RemoteModel.Type): Discovered => ({
  key: model.key,
  name: model.display_name || model.key,
  family: model.architecture,
  type: model.type === "decision" ? "decision" : "chat",
  tools: model.capabilities?.trained_for_tool_use,
  vision: model.capabilities?.vision ?? model.has_vision_adapter,
  context:
    model.loaded_instances.length === 0
      ? model.max_context_length
      : Math.min(...model.loaded_instances.map((instance) => instance.config.context_length)),
})

export const make = createLocalProviderPlugin({
  id: "ruth.provider.lmstudio",
  providerID: "lmstudio",
  name: "LM Studio",
  origin: "http://127.0.0.1:1234",
  stripPathSuffix: /\/(?:api\/)?v[01]$/,
  discover: (client) =>
    client.getJson("/api/v1/models", Response).pipe(
      Effect.map((response) =>
        response.models
          .filter((model) => (model.type === "llm" || model.type === "decision") && model.key.length > 0)
          .map(current),
      ),
      Effect.catch(() =>
        client.getJson("/api/v0/models", BetaResponse).pipe(
          Effect.map((response) =>
            response.data
              .filter((model) => (model.type === "llm" || model.type === "vlm") && model.id.length > 0)
              .map(
                (model): Discovered => ({
                  key: model.id,
                  family: model.arch,
                  type: "chat",
                  tools: model.capabilities?.includes("tool_use"),
                  vision: model.type === "vlm",
                  context: model.loaded_context_length ?? model.max_context_length,
                }),
              ),
          ),
        ),
      ),
      Effect.catch(() =>
        client.getJson("/v1/models", OpenAIResponse).pipe(
          Effect.map((response) =>
            response.data
              .filter((model) => model.id.length > 0 && !/embed/i.test(model.id))
              .map((model): Discovered => ({ key: model.id, type: "chat", tools: true })),
          ),
        ),
      ),
      Effect.map((models) => models.toSorted((a, b) => a.key.localeCompare(b.key))),
    ),
  model: (item) => ({
    id: item.key,
    name: item.name ?? item.key,
    family: item.family,
    type: item.type,
    tools: item.tools,
    vision: item.vision,
    context: item.context,
  }),
})

export const LMStudioPlugin = make()
