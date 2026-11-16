import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const ref = location({ directory: AbsolutePath.make("test") })
const layer = AppNodeBuilder.build(LayerNode.group([Provider.node, Model.node]), [
  Location.node.replace(Layer.succeed(Location.Service, Location.Service.of(ref))),
])

const it = testEffect(layer)

it.effect("hides OpenCode free-catalog models and defaults to ollama/ruth when ruth exists", () =>
  Effect.gen(function* () {
    const providers = yield* Provider.Service
    const models = yield* Model.Service
    const ollama = Provider.ID.make("ollama")
    const opencode = Provider.ID.opencode
    const ruth = Model.ID.make("ruth:latest")
    const iceman = Model.ID.make("iceman-contributor-free")
    yield* providers.transform((editor) => {
      editor.update(ollama, () => {})
      editor.models.update(ollama, ruth, (model) => {
        model.capabilities = { ...model.capabilities, input: ["text"], output: ["text"] }
      })
      editor.update(opencode, () => {})
      editor.models.update(opencode, iceman, (model) => {
        model.time.released = 9000
        model.capabilities = { ...model.capabilities, input: ["text"], output: ["text"] }
      })
    })
    yield* models.transform((editor) => editor.default.set(ollama, Model.ID.make("ruth")))
    const available = yield* models.available()
    expect(available.some((model) => model.id === iceman || model.modelID === iceman)).toBe(false)
    expect((yield* models.default())?.providerID).toBe(ollama)
    const id = (yield* models.default())?.id
    expect(id === "ruth" || id === "ruth:latest").toBe(true)
  }),
)
