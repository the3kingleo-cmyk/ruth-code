import { Global } from "@ruth/util/global"
import { EffectFlock } from "@ruth/util/effect-flock"
import { RUTH_CHANNEL, RUTH_LOCAL, RUTH_VERSION } from "../version"
import { Context, Duration, Effect, FileSystem, Layer, Ref } from "effect"
import { parse, type ParseError } from "jsonc-parser"
import path from "node:path"
import { fetchLatestRelease } from "../github-release"
import { runningBinary, selfUpdate } from "../self-update"
import { action, parseReleaseVersion, type Policy } from "./updater-action"
import { errorMessage } from "../util/error"

/**
 * Updates are off by default. Ruth does not check a remote or call home unless the user
 * turns updates on and sets a release source.
 */
export const methods = ["github"] as const

export type Method = (typeof methods)[number]
export type RunResult = { readonly type: "available" | "installed"; readonly version: string }
export type CheckResult = RunResult | { readonly type: "unavailable"; readonly message: string }

export class UpgradeError extends Error {
  readonly title: string
  readonly detail: string
  readonly command?: string
  readonly retry: string

  constructor(
    input: { readonly title: string; readonly detail: string; readonly command?: string; readonly retry: string },
    options?: ErrorOptions,
  ) {
    super(input.title, options)
    this.name = "UpgradeError"
    this.title = input.title
    this.detail = input.detail
    this.command = input.command
    this.retry = input.retry
  }
}

export interface Interface {
  readonly run: (onInstall?: (version: string) => void) => Effect.Effect<RunResult | undefined>
  readonly check: () => Effect.Effect<CheckResult | undefined, Error>
  readonly apply: (version: string) => Effect.Effect<void, Error>
  readonly method: () => Effect.Effect<Method | undefined>
  /** Kept for callers that explain externally managed copies; Ruth releases are never managed elsewhere. */
  readonly managed: (version?: string) => Effect.Effect<UpgradeError | undefined, Error>
  readonly latest: (method?: Method) => Effect.Effect<string, Error>
  readonly upgrade: (method: Method, version: string) => Effect.Effect<void, Error>
  readonly removal: (
    method: Method,
  ) => { readonly command: ReadonlyArray<string>; readonly run: Effect.Effect<void, Error> } | undefined
}

export class Service extends Context.Service<Service, Interface>()("@ruth/cli/Updater") {}

export function decodePolicy(text: string): Policy | undefined {
  // The CLI only projects this host-level preference instead of initializing
  // the location-scoped server configuration graph.
  const errors: ParseError[] = []
  const input: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || typeof input !== "object" || input === null) return
  if ("update" in input) {
    const value = input.update
    if (value === "disable" || value === "notify" || value === "auto") return value
    return
  }
  if (!("autoupdate" in input)) return
  if (input.autoupdate === false) return "disable"
  if (input.autoupdate === "notify") return "notify"
  if (input.autoupdate === true) return "auto"
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const global = yield* Global.Service
  const flock = yield* EffectFlock.Service
  const installedVersion = yield* Ref.make(RUTH_VERSION)

  const readPolicy = Effect.fnUntraced(function* () {
    const values = yield* Effect.forEach(["config.json", "ruth.json", "ruth.jsonc"], (name) =>
      fs.readFileString(path.join(global.config, name)).pipe(
        Effect.map(decodePolicy),
        Effect.orElseSucceed(() => undefined),
      ),
    )
    return values.findLast((value) => value !== undefined) ?? "disable"
  })

  const method = () => Effect.succeed<Method | undefined>("github")

  const latest = (_method?: Method) =>
    Effect.tryPromise({
      try: () => fetchLatestRelease(),
      catch: (cause) =>
        new UpgradeError(
          {
            title: "Could not check for Ruth updates",
            detail: errorMessage(cause),
            retry: "Check your network, then run ruth upgrade again.",
          },
          { cause },
        ),
    }).pipe(Effect.map((release) => release.tag.replace(/^v/, "")))

  const upgrade = Effect.fnUntraced(function* (_method: Method, input: string) {
    if (!parseReleaseVersion(input)) return yield* Effect.fail(new Error(`Invalid version: ${input}`))
    const target = input.trim().replace(/^v/, "")
    yield* Effect.scoped(
      Effect.gen(function* () {
        // Another Ruth process may be updating at the same time.
        yield* flock.acquire("cli-upgrade", undefined, { timeoutMs: Duration.toMillis("15 minutes") })
        const result = yield* Effect.promise(() =>
          selfUpdate({ currentVersion: RUTH_VERSION, currentBinary: runningBinary(), target }),
        )
        if (!result.ok)
          return yield* Effect.fail(
            new UpgradeError({
              title: "Could not update Ruth",
              detail: result.detail,
              command: "ruth upgrade",
              retry: "Fix the issue above, then run ruth upgrade again.",
            }),
          )
      }),
    )
  })

  const inspect = Effect.fnUntraced(function* () {
    if (RUTH_LOCAL || ["1", "true"].includes(process.env.RUTH_DISABLE_AUTOUPDATE?.toLowerCase() ?? "")) {
      yield* Effect.logInfo("update check skipped", {
        reason: RUTH_LOCAL ? "local-install" : "disabled",
        version: RUTH_VERSION,
        channel: RUTH_CHANNEL,
      })
      return undefined
    }
    const policy = yield* readPolicy()
    if (policy === "disable") {
      yield* Effect.logInfo("update check skipped", { reason: "policy-disabled" })
      return undefined
    }
    const current = yield* Ref.get(installedVersion)
    const version = yield* latest()
    const next = action(current, version, policy)
    yield* Effect.logInfo("update check", { current, latest: version, action: next })
    if (next === "none") return undefined
    return { policy, version }
  })

  const install = Effect.fnUntraced(function* (version: string) {
    const current = yield* Ref.get(installedVersion)
    yield* upgrade("github", version)
    yield* Ref.set(installedVersion, version)
    yield* Effect.logInfo("updated Ruth", { from: current, to: version })
  })

  const apply = Effect.fn("cli.updater.apply")(function* (version: string) {
    yield* install(version)
  })

  const check = Effect.fn("cli.updater.check")(function* () {
    if (RUTH_LOCAL)
      return {
        type: "unavailable" as const,
        message: "This build runs from a source checkout. Use an installed Ruth release to check for updates.",
      }
    const policy = yield* readPolicy()
    if (policy === "disable")
      return {
        type: "unavailable" as const,
        message: "Update checks are off. Ruth does not call a remote unless you turn updates on.",
      }
    const version = yield* latest()
    if (!parseReleaseVersion(version)) return yield* Effect.fail(new Error(`Invalid version: ${version}`))
    const current = yield* Ref.get(installedVersion)
    if (action(current, version, "auto") === "none") {
      // An earlier check may have installed the update while this client is still running.
      return action(RUTH_VERSION, current, "auto") === "none"
        ? undefined
        : { type: "installed" as const, version: current }
    }
    return { type: "available" as const, version }
  })

  const run = Effect.fn("cli.updater.run")(
    function* (onInstall: (version: string) => void = () => {}) {
      const result = yield* inspect()
      if (!result) return undefined
      if (result.policy === "notify") return { type: "available" as const, version: result.version }
      onInstall(result.version)
      yield* install(result.version)
      return { type: "installed" as const, version: result.version }
    },
    Effect.catch((error) => Effect.logWarning("update check failed", { error }).pipe(Effect.as(undefined))),
  )

  return Service.of({
    run,
    check,
    apply,
    method,
    managed: () => Effect.succeed(undefined),
    latest,
    upgrade,
    removal: () => undefined,
  })
})

export const layer = Layer.effect(Service, make)

export * as Updater from "./updater"
export { action, type Action, type Policy } from "./updater-action"
