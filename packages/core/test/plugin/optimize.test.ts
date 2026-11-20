import { describe, expect, test } from "bun:test"
import { SystemPart } from "@ruth/ai/effect"
import { Agent } from "@ruth/core/agent"
import { Plugin } from "@ruth/core/plugin"
import { PluginHooks } from "@ruth/core/plugin/hooks"
import { PluginHost } from "@ruth/core/plugin/host"
import { IdentityPlugin } from "@ruth/core/plugin/identity"
import { OptimizePlugin } from "@ruth/core/plugin/optimize"
import { Session } from "@ruth/core/session"
import { SessionSystemPrompt } from "@ruth/core/session/system-prompt"
import type { SessionHooks } from "@ruth/plugin/effect/session"
import { Model } from "@ruth/schema/model"
import { Provider } from "@ruth/core/provider"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"
import PROMPT_LOCAL from "../../src/plugin/system-prompt/local.txt"

const it = testEffect(PluginTestLayer)
const shared = SessionSystemPrompt.make([])
const makeHost = Effect.gen(function* () {
  const agents = yield* Agent.Service
  const plugins = yield* Plugin.Service
  yield* agents.transform((editor) => editor.update(Agent.ID.make("build"), () => {}))
  return yield* PluginHost.make(plugins, "test")
})

const context = (providerID: string, id: string, system = shared): SessionHooks["context"] => ({
  sessionID: Session.ID.make("ses_model_prompt"),
  agent: Agent.ID.make("build"),
  model: Model.Ref.make({ providerID: Provider.ID.make(providerID), id: Model.ID.make(id) }),
  system: [SystemPart.make(system)],
  messages: [],
  tools: Object.fromEntries(
    ["shell", "read", "grep", "glob", "edit", "write", "patch"].map((name) => [
      name,
      { description: name, input: { type: "object" } },
    ]),
  ),
  options: {},
})

const withLocalNote = (event: SessionHooks["context"]) =>
  `${shared}\n\n${SessionSystemPrompt.render(PROMPT_LOCAL, Object.keys(event.tools))}`

describe("Ruth system prompt", () => {
  test("names Ruth as an all-purpose assistant who acts with tools", () => {
    expect(shared).toContain("You are Ruth")
    expect(shared).toContain("all-purpose assistant")
    expect(shared).toContain("I'm Ruth.")
    expect(shared).toContain("How can I assist you?")
    expect(shared).toContain("call your tools and do the work")
    expect(shared).toContain("Do not describe your features")
    expect(shared).toContain("invent commands")
    expect(shared).not.toContain("${RUTH_TOOL_GUIDANCE}")
  })

  test("renders tool guidance only for available tools", () => {
    const rendered = SessionSystemPrompt.make(["edit"])
    expect(rendered).toContain("Use edit for targeted changes")
    expect(rendered).not.toContain("Use write to create")
  })

  test("only the local-model plugin ships", () => {
    expect(OptimizePlugin.Plugins.map((plugin) => plugin.id)).toEqual(["ruth.prompt.local"])
  })

  test("detects small local models", () => {
    expect(OptimizePlugin.isLocalModel({ providerID: Provider.ID.make("ollama"), id: Model.ID.make("qwen3:4b") })).toBe(true)
    expect(OptimizePlugin.isLocalModel({ providerID: Provider.ID.make("custom"), id: Model.ID.make("ruth:latest") })).toBe(true)
    expect(OptimizePlugin.isLocalModel({ providerID: Provider.ID.make("anthropic"), id: Model.ID.make("claude-opus-5") })).toBe(false)
  })
})

describe("OptimizePlugin", () => {
  it.effect("keeps one shared prompt for cloud models and appends the local note for local ones", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const pluginHost = yield* makeHost
      yield* Effect.forEach(OptimizePlugin.Plugins, (plugin) => plugin.effect(pluginHost), { discard: true })

      for (const [provider, id] of [["anthropic", "claude-opus-5"], ["openai", "gpt-6"], ["zen", "kimi-k3"]] as const) {
        const event = context(provider, id)
        event.system.push(SystemPart.make("Project instructions"))
        yield* hooks.trigger("session", "context", event)
        expect(event.system.map((part) => part.text)).toEqual([shared, "Project instructions"])
      }

      const local = context("ollama", "ruth:latest")
      yield* hooks.trigger("session", "context", local)
      expect(local.system.map((part) => part.text)).toEqual([withLocalNote(local)])
      expect(Object.keys(local.tools).sort()).toEqual(["edit", "glob", "grep", "patch", "read", "shell", "write"])
    }),
  )

  it.effect("leaves an explicit agent system prompt alone", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const hooks = yield* PluginHooks.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("build"), (agent) => {
          agent.system = "Custom agent prompt"
        }),
      )
      const pluginHost = yield* makeHost
      yield* Effect.forEach(OptimizePlugin.Plugins, (plugin) => plugin.effect(pluginHost), { discard: true })
      const event = context("ollama", "ruth:latest", "Custom agent prompt")

      yield* hooks.trigger("session", "context", event)

      expect(event.system.map((part) => part.text)).toEqual(["Custom agent prompt"])
    }),
  )

  it.effect("lists models once per step across prompt and identity plugins", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const hooks = yield* PluginHooks.Service
      const baseHost = yield* makeHost
      let listCalls = 0
      const pluginHost = {
        ...baseHost,
        model: {
          ...baseHost.model,
          list: (input?: Parameters<typeof baseHost.model.list>[0]) =>
            Effect.sync(() => {
              listCalls += 1
            }).pipe(Effect.andThen(baseHost.model.list(input))),
        },
      }
      yield* catalog.transform((editor) => {
        editor.models.update(Provider.ID.make("test"), Model.ID.make("ruth:latest"), (model) => {
          model.name = "Ruth"
        })
      })
      yield* Effect.forEach(OptimizePlugin.Plugins, (plugin) => plugin.effect(pluginHost), { discard: true })
      yield* IdentityPlugin.Plugin.effect(pluginHost)

      const named = context("test", "ruth:latest")
      yield* hooks.trigger("session", "context", named)
      expect(listCalls).toBe(1)
      expect(named.system.map((part) => part.text)).toEqual([
        withLocalNote(named),
        IdentityPlugin.identity({ name: "Ruth", ref: named.model }),
      ])

      const cloud = context("test", "unknown-model")
      yield* hooks.trigger("session", "compaction", cloud)
      expect(listCalls).toBe(2)
      expect(cloud.system.map((part) => part.text)).toEqual([
        shared,
        IdentityPlugin.identity({ name: "unknown-model", ref: cloud.model }),
      ])
    }),
  )
})
