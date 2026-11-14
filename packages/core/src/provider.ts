export * as Provider from "./provider.js"

import { Context, Effect, Layer, Option, Schema, Stream, Struct } from "effect"
import { Provider } from "@ruth/schema/provider"
import { Model } from "@ruth/schema/model"
import { makeLocationNode } from "@ruth/util/effect/app-node"
import { HttpTimeout, type ProviderPackage } from "@ruth/ai/effect"
import { Npm } from "@ruth/util/npm"
import type { DeepMutable } from "./schema.js"
import { importModule, resolveModule } from "@ruth/util/runtime-import"
import { Bus } from "./bus.js"
import { Integration } from "./integration.js"
import { State } from "./state.js"
import { IntegrationConnection } from "./integration/connection.js"
import { Credential } from "@ruth/schema/credential"
import { Location } from "./location.js"
import { freeze } from "immer"
import { AISDKNative } from "./aisdk-native.js"

export { AISDK_PREFIX, aisdk, isAISDK, mergeHeaders, mergeOverlay, packageName } from "./aisdk-native.js"

export const ID = Provider.ID
export type ID = typeof ID.Type

export class LoadError extends Schema.TaggedError<LoadError>()("Provider.LoadError", {
  package: Schema.String,
  cause: Schema.Defect(),
}) {}

const packages = new Map<string, Promise<unknown>>()
const builtins = new Map<string, () => Promise<unknown>>([
  ["@ruth/ai/providers/alibaba", () => import("@ruth/ai/providers/alibaba")],
  ["@ruth/ai/providers/alibaba/chat", () => import("@ruth/ai/providers/alibaba/chat")],
  ["@ruth/ai/providers/alibaba/messages", () => import("@ruth/ai/providers/alibaba/messages")],
  ["@ruth/ai/providers/alibaba/responses", () => import("@ruth/ai/providers/alibaba/responses")],
  ["@ruth/ai/providers/alibaba/images", () => import("@ruth/ai/providers/alibaba/images")],
  ["@ruth/ai/providers/alibaba/embeddings", () => import("@ruth/ai/providers/alibaba/embeddings")],
  ["@ruth/ai/providers/amazon-bedrock", () => import("@ruth/ai/providers/amazon-bedrock")],
  ["@ruth/ai/providers/amazon-bedrock/mantle", () => import("@ruth/ai/providers/amazon-bedrock/mantle")],
  [
    "@ruth/ai/providers/amazon-bedrock/mantle/chat",
    () => import("@ruth/ai/providers/amazon-bedrock/mantle/chat"),
  ],
  [
    "@ruth/ai/providers/amazon-bedrock/mantle/messages",
    () => import("@ruth/ai/providers/amazon-bedrock/mantle/messages"),
  ],
  [
    "@ruth/ai/providers/amazon-bedrock/mantle/responses",
    () => import("@ruth/ai/providers/amazon-bedrock/mantle/responses"),
  ],
  ["@ruth/ai/providers/anthropic", () => import("@ruth/ai/providers/anthropic")],
  ["@ruth/ai/providers/anthropic-compatible", () => import("@ruth/ai/providers/anthropic-compatible")],
  ["@ruth/ai/providers/azure", () => import("@ruth/ai/providers/azure")],
  ["@ruth/ai/providers/azure/chat", () => import("@ruth/ai/providers/azure/chat")],
  ["@ruth/ai/providers/azure/responses", () => import("@ruth/ai/providers/azure/responses")],
  ["@ruth/ai/providers/azure/images", () => import("@ruth/ai/providers/azure/images")],
  ["@ruth/ai/providers/azure/embeddings", () => import("@ruth/ai/providers/azure/embeddings")],
  ["@ruth/ai/providers/azure/messages", () => import("@ruth/ai/providers/azure/messages")],
  ["@ruth/ai/providers/baseten", () => import("@ruth/ai/providers/baseten")],
  ["@ruth/ai/providers/baseten/decisions", () => import("@ruth/ai/providers/baseten/decisions")],
  ["@ruth/ai/providers/byteplus/videos", () => import("@ruth/ai/providers/byteplus/videos")],
  ["@ruth/ai/providers/cerebras", () => import("@ruth/ai/providers/cerebras")],
  ["@ruth/ai/providers/cloudflare-ai-gateway", () => import("@ruth/ai/providers/cloudflare-ai-gateway")],
  [
    "@ruth/ai/providers/cloudflare-ai-gateway/decisions",
    () => import("@ruth/ai/providers/cloudflare-ai-gateway/decisions"),
  ],
  ["@ruth/ai/providers/cloudflare-workers-ai", () => import("@ruth/ai/providers/cloudflare-workers-ai")],
  [
    "@ruth/ai/providers/cloudflare-workers-ai/decisions",
    () => import("@ruth/ai/providers/cloudflare-workers-ai/decisions"),
  ],
  [
    "@ruth/ai/providers/cloudflare-workers-ai/images",
    () => import("@ruth/ai/providers/cloudflare-workers-ai/images"),
  ],
  ["@ruth/ai/providers/cohere", () => import("@ruth/ai/providers/cohere")],
  ["@ruth/ai/providers/cohere/chat", () => import("@ruth/ai/providers/cohere/chat")],
  ["@ruth/ai/providers/cohere/embeddings", () => import("@ruth/ai/providers/cohere/embeddings")],
  ["@ruth/ai/providers/deepinfra", () => import("@ruth/ai/providers/deepinfra")],
  ["@ruth/ai/providers/deepinfra/embeddings", () => import("@ruth/ai/providers/deepinfra/embeddings")],
  ["@ruth/ai/providers/deepseek", () => import("@ruth/ai/providers/deepseek")],
  ["@ruth/ai/providers/digitalocean", () => import("@ruth/ai/providers/digitalocean")],
  ["@ruth/ai/providers/digitalocean/decisions", () => import("@ruth/ai/providers/digitalocean/decisions")],
  ["@ruth/ai/providers/digitalocean/embeddings", () => import("@ruth/ai/providers/digitalocean/embeddings")],
  ["@ruth/ai/providers/digitalocean/images", () => import("@ruth/ai/providers/digitalocean/images")],
  ["@ruth/ai/providers/digitalocean/responses", () => import("@ruth/ai/providers/digitalocean/responses")],
  ["@ruth/ai/providers/fireworks", () => import("@ruth/ai/providers/fireworks")],
  ["@ruth/ai/providers/fireworks/embeddings", () => import("@ruth/ai/providers/fireworks/embeddings")],
  ["@ruth/ai/providers/google", () => import("@ruth/ai/providers/google")],
  ["@ruth/ai/providers/google/decisions", () => import("@ruth/ai/providers/google/decisions")],
  ["@ruth/ai/providers/google/interactions", () => import("@ruth/ai/providers/google/interactions")],
  ["@ruth/ai/providers/google/embeddings", () => import("@ruth/ai/providers/google/embeddings")],
  ["@ruth/ai/providers/google/images", () => import("@ruth/ai/providers/google/images")],
  ["@ruth/ai/providers/google/videos", () => import("@ruth/ai/providers/google/videos")],
  ["@ruth/ai/providers/google-vertex", () => import("@ruth/ai/providers/google-vertex")],
  ["@ruth/ai/providers/google-vertex/chat", () => import("@ruth/ai/providers/google-vertex/chat")],
  ["@ruth/ai/providers/google-vertex/gemini", () => import("@ruth/ai/providers/google-vertex/gemini")],
  [
    "@ruth/ai/providers/google-vertex/interactions",
    () => import("@ruth/ai/providers/google-vertex/interactions"),
  ],
  ["@ruth/ai/providers/google-vertex/messages", () => import("@ruth/ai/providers/google-vertex/messages")],
  ["@ruth/ai/providers/google-vertex/mistral", () => import("@ruth/ai/providers/google-vertex/mistral")],
  ["@ruth/ai/providers/google-vertex/responses", () => import("@ruth/ai/providers/google-vertex/responses")],
  ["@ruth/ai/providers/google-vertex/embeddings", () => import("@ruth/ai/providers/google-vertex/embeddings")],
  ["@ruth/ai/providers/google-vertex/images", () => import("@ruth/ai/providers/google-vertex/images")],
  ["@ruth/ai/providers/google-vertex-messages", () => import("@ruth/ai/providers/google-vertex-messages")],
  ["@ruth/ai/providers/groq", () => import("@ruth/ai/providers/groq")],
  ["@ruth/ai/providers/meta", () => import("@ruth/ai/providers/meta")],
  ["@ruth/ai/providers/meta/chat", () => import("@ruth/ai/providers/meta/chat")],
  ["@ruth/ai/providers/meta/images", () => import("@ruth/ai/providers/meta/images")],
  ["@ruth/ai/providers/meta/messages", () => import("@ruth/ai/providers/meta/messages")],
  ["@ruth/ai/providers/meta/responses", () => import("@ruth/ai/providers/meta/responses")],
  ["@ruth/ai/providers/minimax", () => import("@ruth/ai/providers/minimax")],
  ["@ruth/ai/providers/minimax/chat", () => import("@ruth/ai/providers/minimax/chat")],
  ["@ruth/ai/providers/minimax/images", () => import("@ruth/ai/providers/minimax/images")],
  ["@ruth/ai/providers/minimax/messages", () => import("@ruth/ai/providers/minimax/messages")],
  ["@ruth/ai/providers/minimax/responses", () => import("@ruth/ai/providers/minimax/responses")],
  ["@ruth/ai/providers/minimax/videos", () => import("@ruth/ai/providers/minimax/videos")],
  ["@ruth/ai/providers/mistral", () => import("@ruth/ai/providers/mistral")],
  ["@ruth/ai/providers/moonshot", () => import("@ruth/ai/providers/moonshot")],
  ["@ruth/ai/providers/moonshot/chat", () => import("@ruth/ai/providers/moonshot/chat")],
  ["@ruth/ai/providers/moonshot/messages", () => import("@ruth/ai/providers/moonshot/messages")],
  ["@ruth/ai/providers/moonshot/responses", () => import("@ruth/ai/providers/moonshot/responses")],
  ["@ruth/ai/providers/openai", () => import("@ruth/ai/providers/openai")],
  ["@ruth/ai/providers/openai/chat", () => import("@ruth/ai/providers/openai/chat")],
  ["@ruth/ai/providers/openai/responses", () => import("@ruth/ai/providers/openai/responses")],
  ["@ruth/ai/providers/openai/images", () => import("@ruth/ai/providers/openai/images")],
  ["@ruth/ai/providers/openai/embeddings", () => import("@ruth/ai/providers/openai/embeddings")],
  ["@ruth/ai/providers/openai-compatible", () => import("@ruth/ai/providers/openai-compatible")],
  [
    "@ruth/ai/providers/openai-compatible/responses",
    () => import("@ruth/ai/providers/openai-compatible/responses"),
  ],
  ["@ruth/ai/providers/openai-compatible/images", () => import("@ruth/ai/providers/openai-compatible/images")],
  [
    "@ruth/ai/providers/openai-compatible/decisions",
    () => import("@ruth/ai/providers/openai-compatible/decisions"),
  ],
  [
    "@ruth/ai/providers/openai-compatible/embeddings",
    () => import("@ruth/ai/providers/openai-compatible/embeddings"),
  ],
  [
    "@ruth/ai/providers/openai-compatible-responses",
    () => import("@ruth/ai/providers/openai-compatible-responses"),
  ],
  ["@ruth/ai/providers/ruth/decisions", () => import("@ruth/ai/providers/ruth/decisions")],
  ["@ruth/ai/providers/openrouter", () => import("@ruth/ai/providers/openrouter")],
  ["@ruth/ai/providers/openrouter/decisions", () => import("@ruth/ai/providers/openrouter/decisions")],
  ["@ruth/ai/providers/openrouter/embeddings", () => import("@ruth/ai/providers/openrouter/embeddings")],
  ["@ruth/ai/providers/openrouter/images", () => import("@ruth/ai/providers/openrouter/images")],
  ["@ruth/ai/providers/openrouter/videos", () => import("@ruth/ai/providers/openrouter/videos")],
  ["@ruth/ai/providers/openrouter/responses", () => import("@ruth/ai/providers/openrouter/responses")],
  ["@ruth/ai/providers/togetherai", () => import("@ruth/ai/providers/togetherai")],
  ["@ruth/ai/providers/typesafe-ai/decisions", () => import("@ruth/ai/providers/typesafe-ai/decisions")],
  ["@ruth/ai/providers/venice", () => import("@ruth/ai/providers/venice")],
  ["@ruth/ai/providers/venice/responses", () => import("@ruth/ai/providers/venice/responses")],
  ["@ruth/ai/providers/volcengine/videos", () => import("@ruth/ai/providers/volcengine/videos")],
  ["@ruth/ai/providers/vercel-ai-gateway", () => import("@ruth/ai/providers/vercel-ai-gateway")],
  ["@ruth/ai/providers/vercel-ai-gateway/chat", () => import("@ruth/ai/providers/vercel-ai-gateway/chat")],
  [
    "@ruth/ai/providers/vercel-ai-gateway/messages",
    () => import("@ruth/ai/providers/vercel-ai-gateway/messages"),
  ],
  [
    "@ruth/ai/providers/vercel-ai-gateway/responses",
    () => import("@ruth/ai/providers/vercel-ai-gateway/responses"),
  ],
  [
    "@ruth/ai/providers/vercel-ai-gateway/decisions",
    () => import("@ruth/ai/providers/vercel-ai-gateway/decisions"),
  ],
  ["@ruth/ai/providers/vercel-ai-gateway/images", () => import("@ruth/ai/providers/vercel-ai-gateway/images")],
  [
    "@ruth/ai/providers/vercel-ai-gateway/embeddings",
    () => import("@ruth/ai/providers/vercel-ai-gateway/embeddings"),
  ],
  ["@ruth/ai/providers/xai", () => import("@ruth/ai/providers/xai")],
  ["@ruth/ai/providers/xai/images", () => import("@ruth/ai/providers/xai/images")],
  ["@ruth/ai/providers/xai/videos", () => import("@ruth/ai/providers/xai/videos")],
  ["@ruth/ai/providers/zai", () => import("@ruth/ai/providers/zai")],
  ["@ruth/ai/providers/zai/chat", () => import("@ruth/ai/providers/zai/chat")],
  ["@ruth/ai/providers/zai/images", () => import("@ruth/ai/providers/zai/images")],
  ["@ruth/ai/providers/zai-coding-plan", () => import("@ruth/ai/providers/zai-coding-plan")],
  ["@ruth/ai/providers/zai-coding-plan/chat", () => import("@ruth/ai/providers/zai-coding-plan/chat")],
  ["@ruth/ai/providers/zai-coding-plan/messages", () => import("@ruth/ai/providers/zai-coding-plan/messages")],
  [
    "@ruth/ai/providers/zai-coding-plan/responses",
    () => import("@ruth/ai/providers/zai-coding-plan/responses"),
  ],
])

/** Native `@ruth/ai/providers/*` entrypoints bundled with Core and loadable by name from config. */
export const builtinPackages: ReadonlySet<string> = new Set(builtins.keys())

export const loadPackage = Effect.fn("Provider.loadPackage")(function* (input: string, npm?: Npm.Interface) {
  const specifier = AISDKNative.packageName(input)
  const builtin = builtins.get(specifier)
  if (builtin) return yield* importPackage(specifier, specifier, builtin)
  const resolved = yield* Effect.sync(() => {
    if (specifier.startsWith("file://") || specifier.startsWith("@ruth/ai/")) return specifier
    try {
      return import.meta.resolve(specifier)
    } catch {
      return undefined
    }
  })
  if (resolved) return yield* importPackage(specifier, resolved)
  if (!npm) {
    return yield* new LoadError({
      package: specifier,
      cause: new Error(`Provider package ${specifier} is not installed`),
    })
  }
  const parts = specifier.split("/")
  const root = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier)
  const installed = yield* npm.add(root).pipe(Effect.mapError((cause) => new LoadError({ package: specifier, cause })))
  const entrypoint = yield* Effect.try({
    try: () => resolveModule(specifier, installed.directory),
    catch: (cause) => new LoadError({ package: specifier, cause }),
  })
  return yield* importPackage(specifier, entrypoint)
})

const settingsKeys = Struct.keys(Provider.Settings.schema.fields)
const providerOnlyKeys = settingsKeys.filter((key) => !(key in Model.Settings.schema.fields))

/** The provider options: every settings key Ruth doesn't read itself. */
export function nativeSettings(settings: Settings) {
  return Struct.omit(settings, settingsKeys)
}

/** Settings a model inherits from its provider. */
export function modelSettings(settings: Settings | undefined) {
  return settings && Struct.omit(settings, providerOnlyKeys)
}

const decodeTimeout = Schema.decodeUnknownOption(HttpTimeout)

/** Applied to `headerTimeout` when provider settings leave it unset or invalid. */
export const DEFAULT_TIMEOUT_MS = 300_000

/** 20 minutes: local models can sit quiet a long time before the first token. */
export const DEFAULT_LOCAL_HEADER_TIMEOUT_MS = 1_200_000

const LOCAL_PROVIDER_IDS = new Set(["ollama", "lmstudio", "llama.cpp", "llamacpp", "local"])

export function isLocalProvider(providerID: string | undefined): boolean {
  if (!providerID) return false
  const id = providerID.toLowerCase()
  if (LOCAL_PROVIDER_IDS.has(id)) return true
  return id.includes("ollama") || id.includes("lmstudio") || id.includes("llama.cpp")
}


/**
 * Applied to `chunkTimeout` when provider settings leave it unset or invalid. Some providers, such as DeepSeek, have
 * specifically asked clients to allow at least 15 minutes, because their models can stream nothing for minutes while
 * they reason.
 */
export const DEFAULT_CHUNK_TIMEOUT_MS = 900_000

/** One timeout setting without a default; invalid values are dropped. */
export function timeout(value: unknown) {
  return Option.getOrUndefined(decodeTimeout(value))
}

/** Request timeouts from provider settings, resolved for every route. `timeout` has no default. */
export function timeouts(settings: Readonly<Record<string, unknown>>, providerID?: string) {
  const local = isLocalProvider(providerID)
  return {
    timeout: timeout(settings.timeout),
    headerTimeout: timeout(settings.headerTimeout) ?? (local ? DEFAULT_LOCAL_HEADER_TIMEOUT_MS : DEFAULT_TIMEOUT_MS),
    chunkTimeout: timeout(settings.chunkTimeout) ?? DEFAULT_CHUNK_TIMEOUT_MS,
  }
}

const decodeEncoding = Schema.decodeUnknownOption(Provider.Encoding)

/** Request body encoding from provider or model settings; invalid values are dropped. */
export function encoding(settings: Readonly<Record<string, unknown>>) {
  return Option.getOrUndefined(decodeEncoding(settings.encoding))
}

const decodeTls = Schema.decodeUnknownOption(Provider.Tls)

/** Client certificate from provider settings. An empty `cert` or `key`, such as a missing `{file:}`, leaves it unset. */
export function tls(settings: Readonly<Record<string, unknown>>) {
  const value = Option.getOrUndefined(decodeTls(settings.tls))
  return value?.cert && value.key ? value : undefined
}

export const Request = Provider.Request
export type Request = Provider.Request

export const Compaction = Provider.Compaction
export type Compaction = Provider.Compaction

export const Cache = Provider.Cache
export type Cache = Provider.Cache

export const Transport = Provider.Transport
export type Transport = Provider.Transport

export const Settings = Provider.Settings
export type Settings = Provider.Settings

export const Info = Provider.Info
export type Info = Provider.Info

export type MutableInfo = DeepMutable<Info>

export { Event } from "@ruth/schema/provider"

/** Provider metadata owns its drafts; model definitions remain immutable inputs. */
export type Definition = {
  readonly provider: Info
  readonly models: ReadonlyMap<Model.ID, Model.Info>
  readonly sourceConnection?: IntegrationConnection.Info
}

export interface Editor {
  readonly list: () => readonly Definition[]
  readonly get: (providerID: ID) => Definition | undefined
  readonly add: (definition: {
    readonly info: Info
    readonly models: readonly Model.Info[]
    readonly sourceConnection?: IntegrationConnection.Info
  }) => void
  readonly update: (providerID: ID, update: (provider: MutableInfo) => void) => void
  readonly remove: (providerID: ID) => void
  readonly models: {
    readonly set: (providerID: ID, models: readonly Model.Info[]) => void
    readonly update: (providerID: ID, modelID: Model.ID, update: (model: DeepMutable<Model.Info>) => void) => void
    readonly remove: (providerID: ID, modelID: Model.ID) => void
  }
}

export interface Snapshot {
  readonly records: ReadonlyMap<ID, Definition>
  readonly available: readonly Definition[]
  readonly providers: readonly Info[]
}

export interface Interface extends State.Transformable<Editor> {
  readonly get: (providerID: ID) => Effect.Effect<Info | undefined>
  readonly all: () => Effect.Effect<readonly Info[]>
  readonly available: () => Effect.Effect<readonly Info[]>
  /** Internal definition/access snapshot; raw model inventories never cross the HTTP API. */
  readonly snapshot: () => Effect.Effect<Snapshot>
}

export class Service extends Context.Service<Service, Interface>()("@ruth/Provider") {}

// Every location references the same index for a shared immutable definition array.
const definitions = new WeakMap<readonly Model.Info[], Map<ID, ReadonlyMap<Model.ID, Model.Info>>>()
function index(providerID: ID, models: readonly Model.Info[]) {
  const indexes = definitions.get(models) ?? new Map<ID, ReadonlyMap<Model.ID, Model.Info>>()
  const cached = indexes.get(providerID)
  if (cached) return cached
  // Model shares these definitions without copying, so a foreign definition takes this provider's identity here.
  const result = freeze(
    new Map(models.map((model) => [model.id, model.providerID === providerID ? model : { ...model, providerID }])),
    true,
  )
  indexes.set(providerID, result)
  definitions.set(models, indexes)
  return result
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const integrations = yield* Integration.Service
    const location = yield* Location.Service
    const state = State.create<
      Map<
        ID,
        {
          provider: MutableInfo
          models: ReadonlyMap<Model.ID, Model.Info>
          sourceConnection?: IntegrationConnection.Info
        }
      >,
      Editor
    >({
      name: "provider",
      initial: () => new Map(),
      editor: (records) => {
        const maps = new WeakSet<ReadonlyMap<Model.ID, Model.Info>>()
        const models = new WeakSet<Model.Info>()
        const entry = (id: ID) => {
          const current = records.get(id)
          if (current) return current
          const added = { provider: Info.empty(id) as MutableInfo, models: new Map<Model.ID, Model.Info>() }
          records.set(id, added)
          maps.add(added.models)
          return added
        }
        const writable = (id: ID) => {
          const record = entry(id)
          if (maps.has(record.models)) return record.models as Map<Model.ID, Model.Info>
          const owned = new Map(record.models)
          record.models = owned
          maps.add(owned)
          return owned
        }
        return {
          list: () => Array.from(records.values()),
          get: (id) => records.get(id),
          add: (definition) => {
            records.set(definition.info.id, {
              provider: structuredClone(definition.info) as MutableInfo,
              models: index(definition.info.id, definition.models),
              sourceConnection: definition.sourceConnection,
            })
          },
          update: (id, update) => {
            const record = entry(id)
            update(record.provider)
            record.provider.id = id
            AISDKNative.rewrite(record.provider, {
              builtins: builtinPackages,
              specifier: record.provider.package,
              providerID: id,
              canonical: record.provider.canonical,
            })
          },
          remove: (id) => {
            records.delete(id)
          },
          models: {
            set: (id, values) => {
              entry(id).models = index(id, values)
            },
            update: (providerID, modelID, update) => {
              const record = entry(providerID)
              const target = writable(providerID)
              const current = target.get(modelID)
              const model = // An earlier add/set can publish and freeze an owned model within this fold.
                (
                  current && models.has(current) && !Object.isFrozen(current)
                    ? current
                    : current
                      ? structuredClone(current)
                      : Model.Info.default(providerID, modelID)
                ) as DeepMutable<Model.Info>
              update(model)
              model.id = modelID
              model.providerID = providerID
              AISDKNative.rewrite(model, {
                builtins: builtinPackages,
                specifier: model.package ?? record.provider.package,
                providerID,
                canonical: model.canonical ?? record.provider.canonical,
                modelID: model.modelID ?? modelID,
              })
              models.add(model)
              target.set(modelID, model)
            },
            remove: (providerID, modelID) => {
              if (!records.has(providerID)) return
              writable(providerID).delete(modelID)
            },
          },
        }
      },
      notify: () => notify,
    })
    // Registrations may outlive a borrowed service layer; their later disposal must
    // not query dependencies that have already closed.
    yield* Effect.addFinalizer(() => State.shutdown(state.reload()))
    let cached: { records: Snapshot["records"]; value: Snapshot } | undefined
    const snapshot = Effect.fn("Provider.snapshot")(function* () {
      while (true) {
        const revision = integrations.revision()
        const records = state.get()
        // Connection presence decides availability; resolving OAuth tokens belongs to execution.
        const connections = yield* integrations.list()
        // Either fold can disable a plugin that also contributed to the other domain.
        if (revision !== integrations.revision() || records !== state.get()) continue
        const byID = new Map(connections.map((integration) => [integration.id, integration]))
        const available = Array.from(records.values()).filter((record) => {
          if (record.provider.activation === "disabled") return false
          const integration = byID.get(record.provider.integrationID ?? Integration.ID.make(record.provider.id))
          // Never combine the previous account's discovered endpoints/models with a new connection.
          if (
            record.sourceConnection &&
            IntegrationConnection.key(record.sourceConnection) !==
              IntegrationConnection.key(integration?.connections[0])
          )
            return false
          if (record.provider.activation === "enabled") return true
          if (integration?.connections.length) return true
          return record.provider.integrationID === undefined && !integration
        })
        // A credential change that leaves the same definitions available is not a catalog change.
        if (
          cached?.records === records &&
          cached.value.available.length === available.length &&
          cached.value.available.every((record, index) => record === available[index])
        )
          return cached.value
        const value = freeze({ records, available, providers: available.map((record) => record.provider) }, true)
        cached = { records, value }
        return value
      }
    })
    let published: Snapshot | undefined
    const notify: Effect.Effect<void> = Effect.gen(function* () {
      const value = yield* snapshot()
      if (value === published) return
      published = value
      yield* bus.publish(
        Provider.Event.Updated,
        {},
        {
          location: { directory: location.directory, workspaceID: location.workspaceID },
        },
      )
    })
    yield* bus.subscribe([Integration.Event.Updated, Credential.Event.Switched]).pipe(
      Stream.runForEach(() => notify),
      Effect.forkScoped({ startImmediately: true }),
    )
    return Service.of({
      transform: state.transform,
      reload: state.reload,
      get: Effect.fn("Provider.get")((id) => Effect.sync(() => freeze(state.get().get(id)?.provider, true))),
      all: Effect.fn("Provider.all")(() =>
        Effect.sync(() => Array.from(state.get().values(), (record) => freeze(record.provider, true))),
      ),
      available: Effect.fn("Provider.available")(() => snapshot().pipe(Effect.map((value) => value.providers))),
      snapshot,
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Bus.node, Integration.node, Location.node] })

const importPackage = Effect.fn("Provider.importPackage")(function* (
  specifier: string,
  entrypoint: string,
  load = () => importModule(entrypoint),
) {
  const module = yield* Effect.tryPromise({
    try: () => {
      const existing = packages.get(entrypoint)
      if (existing) return existing
      const loaded = load()
      packages.set(entrypoint, loaded)
      return loaded
    },
    catch: (cause) => new LoadError({ package: specifier, cause }),
  })
  if (typeof module !== "object" || module === null || typeof (module as { model?: unknown }).model !== "function") {
    return yield* new LoadError({
      package: specifier,
      cause: new Error(`Provider package ${specifier} does not export model(modelID, settings)`),
    })
  }
  return module as ProviderPackage.Definition
})
