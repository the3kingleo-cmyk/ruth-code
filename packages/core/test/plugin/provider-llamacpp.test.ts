import { Config } from "@ruth/core/config"
import { Model } from "@ruth/core/model"
import { Plugin } from "@ruth/core/plugin"
import { PluginHost } from "@ruth/core/plugin/host"
import { ProviderPlugins } from "@ruth/core/plugin/provider"
import { make as makeLlamaCpp } from "@ruth/core/plugin/provider/llamacpp"
import { make as makeLocal } from "@ruth/core/plugin/provider/openai-local"
import { Provider } from "@ruth/core/provider"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { eventually } from "../lib/eventually"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(Layer.merge(PluginTestLayer, Config.testLayer()))

const serve = (handler: (path: string) => Response) =>
  Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ port: 0, fetch: (request) => handler(new URL(request.url).pathname) })),
    (server) => Effect.promise(() => server.stop(true)),
  )

describe("llama.cpp provider", () => {
  it.live("discovers llama-server models with their context and vision support", () =>
    Effect.gen(function* () {
      expect(ProviderPlugins.map((item) => item.id)).toContain("ruth.provider.llamacpp")
      expect(ProviderPlugins.map((item) => item.id)).toContain("ruth.provider.local")
      const server = yield* serve((path) => {
        if (path === "/v1/models")
          return Response.json({
            object: "list",
            data: [{ id: "gemma-3-4b-it-Q4_K_M.gguf", owned_by: "llamacpp", meta: { n_ctx_train: 131072 } }],
          })
        if (path === "/props")
          return Response.json({
            default_generation_settings: { n_ctx: 8192 },
            modalities: { vision: true },
            chat_template: "{% if tools %}...{% endif %}",
          })
        return new Response("not found", { status: 404 })
      })
      const host = yield* PluginHost.make(yield* Plugin.Service, "test")
      yield* makeLlamaCpp(server.url.origin, "5 millis").effect(host)
      const model = yield* eventually(
        (yield* Model.Service).get(Provider.ID.make("llama.cpp"), Model.ID.make("gemma-3-4b-it-Q4_K_M.gguf")),
        (item) => item !== undefined,
      )
      expect(model).toMatchObject({
        name: "gemma-3-4b-it-Q4_K_M",
        capabilities: { tools: true, input: ["text", "image"] },
        limit: { context: 8192 },
      })
    }),
  )

  it.live("ignores other servers on port 8080", () =>
    Effect.gen(function* () {
      const server = yield* serve((path) =>
        path === "/v1/models" ? Response.json({ data: [{ id: "x", owned_by: "someone" }] }) : new Response("", { status: 404 }),
      )
      const host = yield* PluginHost.make(yield* Plugin.Service, "test")
      yield* makeLlamaCpp(server.url.origin, "5 millis").effect(host)
      yield* Effect.promise(() => Bun.sleep(50))
      expect(yield* (yield* Provider.Service).get(Provider.ID.make("llama.cpp"))).toBeUndefined()
    }),
  )
})

describe("generic local provider", () => {
  it.live("lists every chat model from a connected OpenAI-compatible server", () =>
    Effect.gen(function* () {
      const server = yield* serve((path) =>
        path === "/v1/models"
          ? Response.json({ data: [{ id: "mistral-7b" }, { id: "nomic-embed-text" }, { id: "qwen", max_model_len: 32768 }] })
          : new Response("", { status: 404 }),
      )
      const host = yield* PluginHost.make(yield* Plugin.Service, "test")
      yield* makeLocal(server.url.origin, "5 millis").effect(host)
      const models = yield* (yield* Model.Service)
        .get(Provider.ID.make("local"), Model.ID.make("qwen"))
        .pipe((effect) => eventually(effect, (item) => item !== undefined))
      expect(models).toMatchObject({ capabilities: { tools: true }, limit: { context: 32768 } })
      expect(yield* (yield* Model.Service).get(Provider.ID.make("local"), Model.ID.make("nomic-embed-text"))).toBeUndefined()
    }),
  )
})
