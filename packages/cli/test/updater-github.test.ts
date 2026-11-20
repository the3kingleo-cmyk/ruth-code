import { NodeServices } from "@effect/platform-node"
import { EffectFlock } from "@ruth/util/effect-flock"
import { LayerNode } from "@ruth/util/effect/layer-node"
import { Global } from "@ruth/util/global"
import { afterEach, expect, spyOn, test } from "bun:test"
import { Effect, FileSystem, Layer } from "effect"
import path from "node:path"
import { repoSlug } from "../src/github-release"
import { Updater } from "../src/services/updater"
import { testEffect } from "../../core/test/lib/effect"

const it = testEffect(NodeServices.layer)

afterEach(() => {
  delete process.env.RUTH_REPO_SLUG
})

const updater = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "ruth-updater-" })
  const dir = (name: string) => path.join(root, name)
  const global = Global.make({
    home: dir("home"),
    data: dir("data"),
    cache: dir("cache"),
    config: dir("config"),
    state: dir("state"),
    tmp: dir("tmp"),
    bin: dir("bin"),
    log: dir("log"),
    repos: dir("repos"),
  })
  return yield* Updater.Service.pipe(
    Effect.provide(Updater.layer),
    Effect.provide(
      LayerNode.compile(EffectFlock.node, {
        replacements: [Global.node.replace(Layer.succeed(Global.Service, global))],
      }),
    ),
    Effect.provideService(Global.Service, global),
  )
})

test("GitHub releases are the only update method", () => {
  expect(Updater.methods).toEqual(["github"])
})

test("there is no default release repo", () => {
  expect(repoSlug()).toBe("")
  process.env.RUTH_REPO_SLUG = "someone-else/ruth-install"
  expect(repoSlug()).toBe("someone-else/ruth-install")
  process.env.RUTH_REPO_SLUG = "-beta"
  expect(repoSlug()).toBe("")
})

it.live("does not call a remote when update checks are off", () =>
  Effect.gen(function* () {
    const fetchSpy = spyOn(globalThis, "fetch")
    try {
      const service = yield* Effect.scoped(updater)
      expect(yield* service.method()).toBe("github")
      const result = yield* service.check()
      expect(result?.type).toBe("unavailable")
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(service.removal("github")).toBeUndefined()
      expect(yield* service.managed()).toBeUndefined()
    } finally {
      fetchSpy.mockRestore()
    }
  }),
)

it.live("rejects invalid upgrade targets before downloading anything", () =>
  Effect.gen(function* () {
    const fetchSpy = spyOn(globalThis, "fetch")
    try {
      const service = yield* Effect.scoped(updater)
      const error = yield* service.upgrade("github", "not-a-version").pipe(Effect.flip)
      expect(error.message).toBe("Invalid version: not-a-version")
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  }),
)
