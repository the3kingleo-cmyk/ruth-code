import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@ruth/core/effect/app-node-builder"
import { Config } from "@ruth/core/config"
import { Document, Info } from "@ruth/schema/config"
import { Effect, Layer, Stream } from "effect"
import { SkillPlugin } from "@ruth/core/plugin/skill"
import { Skill } from "@ruth/core/skill"
import { testEffect } from "../lib/effect"
import { host } from "./host"

const it = testEffect(AppNodeBuilder.build(Skill.node))
const config = (plugins: Info["plugins"] = []) =>
  Layer.succeed(
    Config.Service,
    Config.Service.of({
      entries: () => Effect.succeed([new Document({ type: "document", info: new Info({ plugins }) })]),
      changes: () => Stream.never,
    }),
  )

describe("SkillPlugin.Plugin", () => {
  it.effect("registers built-in skills", () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      yield* SkillPlugin.Plugin.effect(
        host({
          app: { name: "test", version: "1.2.3", channel: "beta" },
          skill: {
            list: () => Effect.die("unused skill.list"),
            transform: skill.transform,
            reload: skill.reload,
          },
        }),
      ).pipe(Effect.provide(config()))
      const skills = yield* skill.list()
      const report = skills.find((item) => item.id === "report")

      expect(skills).toContainEqual(
        expect.objectContaining({
          id: "ruth",
          name: "Ruth",
          path: "skill://ruth/SKILL.md",
          description: expect.stringContaining("any question about Ruth itself"),
        }),
      )
      expect(skills).toContainEqual(
        expect.objectContaining({
          id: "report",
          name: "Report",
          path: "skill://report/SKILL.md",
          description: expect.stringContaining("Ruth issue"),
        }),
      )
      expect(report?.content).toContain("- ruth version: 1.2.3")
      expect(report?.content).toContain("- install/channel: beta")
    }),
  )

  it.effect("reports canonical configured plugin sources with existing labels and ordering", () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      yield* SkillPlugin.Plugin.effect(
        host({
          skill: {
            list: () => Effect.die("unused skill.list"),
            transform: skill.transform,
            reload: skill.reload,
          },
        }),
      )
      const report = (yield* skill.list()).find((item) => item.id === "report")
      expect(report?.content).toContain("- Active plugins: -disabled, local.ts, package-plugin, package-plugin")
    }).pipe(
      Effect.provide(
        config([
          "package-plugin",
          "-disabled",
          "local.ts",
          { package: "package-plugin", options: { enabled: true } },
        ]),
      ),
    ),
  )
})
