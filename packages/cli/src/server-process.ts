export * as ServerProcess from "./server-process"

import { NodeServices } from "@effect/platform-node"
import { Service } from "@ruth/client/effect/service"
import { LayerNode } from "@ruth/util/effect/layer-node"
import { Global } from "@ruth/util/global"
import { RUTH_ARTIFACT, RUTH_CHANNEL, RUTH_VERSION } from "./version"
import { AppProcess } from "@ruth/util/process"
import { randomBytes, randomUUID } from "node:crypto"
import { Effect, Option, Redacted, Schema } from "effect"
import { PersistentPty } from "@ruth/schema/persistent-pty"
import { HttpServer } from "effect/http"
import { NetAddress } from "effect/net"
import { Env } from "./env"
import { PortOwner } from "./services/port-owner"
import { ServiceConfig } from "./services/service-config"
import { RetainedImage } from "./services/retained-image"
import { ServiceRegistration } from "./services/service-registration"
import { RemoteTunnel } from "./services/remote-tunnel"
import { WebUi } from "./services/web-ui"
import { recoverAfterBootFailure, recoverIfNeeded } from "./boot-recovery"
import { ensureRuthModel } from "./ensure-ruth-model"
import { LOCAL_OLLAMA_ORIGIN } from "@ruth/util/ollama-origin"
import { databasePath } from "./database-path"
import { shouldEnableFilewatcher } from "./filewatcher-policy"

export type Mode = "default" | "service" | "stdio"

export type Options = {
  readonly mode: Mode
  readonly hostname?: string
  readonly port?: number
  readonly cors?: readonly string[]
}

// The process effect lives until server shutdown; tracing it would parent every request to one process-lifetime trace.
export const run = Effect.fnUntraced(function* (options: Options) {
  return yield* processEffect(options).pipe(
    Effect.provide(
      LayerNode.compile(LayerNode.group([Global.node, AppProcess.node]), {
        replacements: [
          Global.node.replace(
            Global.layerWith(process.env.RUTH_CONFIG_DIR ? { config: process.env.RUTH_CONFIG_DIR } : {}),
          ),
        ],
      }),
    ),
    Effect.provide(NodeServices.layer),
  )
})

const processEffect = Effect.fnUntraced(function* (options: Options) {
  const inherited = process.env.RUTH_PTY_HANDOFF
  delete process.env.RUTH_PTY_HANDOFF
  const handoff =
    inherited === undefined
      ? undefined
      : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PersistentPty.Handoff))(inherited).pipe(
          Effect.catch(() =>
            Effect.logWarning("Ignoring invalid PTY restart handoff; persistent terminals will start fresh").pipe(
              Effect.as(undefined),
            ),
          ),
        )
  const global = yield* Global.Service
  const roots = { data: global.data, config: global.config, state: global.state, home: global.home }
  const recovered = recoverIfNeeded(roots, databasePath(global.data))
  if (recovered.length > 0) {
    yield* Effect.logWarning("Moved leftover Ruth data aside and starting with a fresh data directory", {
      backup: recovered,
    })
  }
  // A sandbox may deny $HOME; the service then keeps the cwd it was launched from.
  if (options.mode === "service")
    yield* Effect.try(() => process.chdir(global.home)).pipe(
      Effect.catch((cause) => Effect.logWarning("failed to change service directory to home", { cause })),
    )
  return yield* Effect.scoped(
    Effect.gen(function* () {
      // Recreate the default `ruth` model from the bundled files so a leftover tag cannot
      // keep a short context or an old SYSTEM prompt. A down Ollama does not fail boot.
      const ensured = yield* Effect.promise(() => ensureRuthModel({ origin: LOCAL_OLLAMA_ORIGIN })).pipe(
        Effect.timeout("90 seconds"),
        Effect.option,
      )
      if (Option.isSome(ensured) && ensured.value.ok) {
        yield* Effect.logInfo("Connected to the local ruth model", {
          origin: ensured.value.origin,
          created: ensured.value.created,
        })
      } else {
        yield* Effect.logWarning("Local ruth model is not ready yet", {
          reason: Option.isSome(ensured) ? ensured.value.reason : "timed out",
        })
      }
      const foreground = options.mode === "default"
      const serviceOptions = options.mode === "service" ? yield* ServiceConfig.options() : undefined
      const config = options.mode === "service" ? yield* ServiceConfig.read() : {}
      const hostname = options.hostname ?? config.hostname ?? "127.0.0.1"
      const port = options.port ?? config.port ?? (options.mode === "service" ? ServiceConfig.defaultPort() : undefined)
      const findIncumbent =
        serviceOptions !== undefined && port !== undefined
          ? Service.incumbent({ ...serviceOptions, url: serviceURL(hostname, port) })
          : undefined
      if (findIncumbent !== undefined && (yield* findIncumbent) !== undefined) return
      // Desktop can launch the service directly without injecting its saved environment.
      Object.assign(process.env, ServiceConfig.processEnv(config.env))
      // Keep a package-manager or curl install replaceable while the service runs; Desktop updates its own copy.
      if (options.mode === "service" && process.platform === "win32" && RetainedImage.installed(global.home))
        yield* RetainedImage.retain(global.cache, "service")
      const { start } = yield* Effect.promise(() => import("@ruth/server/process"))
      const environmentPassword = yield* Env.password
      // Keep the lease credential out of the environment inherited by tools.
      if (options.mode === "stdio") {
        delete process.env.RUTH_PASSWORD
        delete process.env.RUTH_SERVER_PASSWORD
      }
      const password =
        options.mode === "service"
          ? config.password || randomBytes(32).toString("base64url")
          : environmentPassword
            ? Redacted.value(environmentPassword)
            : randomBytes(32).toString("base64url")
      if (!password) return yield* Effect.fail(new Error("Missing server password"))
      const instanceID = randomUUID()
      const transform = yield* WebUi.handler()
      const remote = { urls: [] as ReadonlyArray<string> }
      const launch = (bindPort?: number) => start(
        {
          app: {
            name: process.env.RUTH_CLIENT ?? RUTH_ARTIFACT,
            version: RUTH_VERSION,
            channel: RUTH_CHANNEL,
          },
          hostname,
          port: bindPort,
          cors: options.cors ?? config.cors,
          password,
          pty: { handoff },
          simulation: truthy(process.env.RUTH_SIMULATE),
          database: {
            path: databasePath(global.data),
          },
          models: {
            url: process.env.RUTH_MODELS_URL,
            file: process.env.RUTH_MODELS_PATH,
            // Local-first: the bundled catalog is used offline. Live refreshes only run when asked for.
            fetch:
              !truthy(process.env.RUTH_DISABLE_MODELS_FETCH) &&
              (truthy(process.env.RUTH_MODELS_FETCH) || Boolean(process.env.RUTH_MODELS_URL)),
          },
          config: {
            directory: process.env.RUTH_CONFIG_DIR,
            project: !truthy(
              process.env.RUTH_CONFIG_PROJECT_DISABLE ?? process.env.RUTH_DISABLE_PROJECT_CONFIG,
            ),
            // .claude is only read for skills, so both flags gate the same roots.
            claude: !(
              truthy(process.env.RUTH_DISABLE_CLAUDE_CODE) ||
              truthy(process.env.RUTH_DISABLE_CLAUDE_CODE_SKILLS)
            ),
            file: process.env.RUTH_CONFIG,
            content: process.env.RUTH_CONFIG_CONTENT,
          },
          windows: {
            gitbash: process.env.RUTH_GIT_BASH_PATH,
          },
          fs: {
            filewatcher: shouldEnableFilewatcher().enabled,
            fff:
              process.env.RUTH_DISABLE_FFF === undefined
                ? process.platform !== "win32"
                : !truthy(process.env.RUTH_DISABLE_FFF),
          },
        },
        serviceOptions === undefined
          ? undefined
          : {
              onListen: (address, shutdown) =>
                Effect.gen(function* () {
                  if (!config.password) yield* ServiceConfig.password(password)
                  return yield* ServiceRegistration.register({
                    address,
                    password,
                    id: instanceID,
                    file: serviceOptions.file,
                    shutdown,
                  })
                }),
            },
        transform,
        () => remote.urls,
      )
      const bind = (bindPort?: number) => launch(bindPort).pipe(Effect.catchIf(addressInUse, () => Effect.void))

      const takeOverOrRelocate = Effect.fnUntraced(function* (cause: unknown) {
        if (findIncumbent === undefined) return yield* Effect.fail(cause)
        if (port !== undefined) {
          // A sibling that is still starting holds the port before it registers; give it time to settle.
          const holder = yield* PortOwner.inspect(port, hostname)
          const unrelated =
            holder !== undefined &&
            !PortOwner.isManagedService(holder.command) &&
            !PortOwner.isServiceProcess(holder.command)
          const deadline = unrelated ? 0 : Date.now() + 8_000
          while (Date.now() < deadline) {
            const found = yield* findIncumbent.pipe(Effect.timeoutOption("2 seconds"))
            if (Option.isSome(found) && found.value !== undefined) return
            if ((yield* PortOwner.inspect(port, hostname)) === undefined) {
              const freed = yield* bind(port)
              if (freed !== undefined) return freed
            }
            yield* Effect.sleep("250 millis")
          }
          const owner = yield* PortOwner.inspect(port, hostname)
          if (owner !== undefined && owner.pid !== process.pid && PortOwner.isManagedService(owner.command)) {
            yield* Effect.logInfo("Stopping stale managed service on the configured port", {
              pid: owner.pid,
              port,
              command: owner.command,
            })
            yield* PortOwner.terminate(owner.pid)
            yield* PortOwner.waitUntilFree(port, hostname)
            const retried = yield* bind(port)
            if (retried !== undefined) return retried
          }
        }
        // Unrelated process, unknown owner, or the stale service did not release the port: move.
        const relocated = yield* bind(undefined)
        if (relocated === undefined) return yield* Effect.fail(cause)
        if (NetAddress.isInetAddress(relocated.address)) {
          const next = relocated.address.port
          yield* ServiceConfig.savePort(next)
          yield* Effect.logInfo("Configured service port was busy; moved to a free port", { from: port, to: next })
        }
        return relocated
      })

      const server = yield* launch(port).pipe(
        Effect.catch((error) => {
          if (addressInUse(error)) return takeOverOrRelocate(error)
          return Effect.gen(function* () {
            const moved = recoverAfterBootFailure(roots, error)
            if (!moved) return yield* Effect.fail(error)
            yield* Effect.logWarning("Server boot failed; moved leftover data aside and retrying", {
              backup: moved,
            })
            return yield* launch(port)
          })
        }),
      )
      if (server === undefined) return
      if (serviceOptions !== undefined && config.remote !== undefined && NetAddress.isInetAddress(server.address)) {
        const bound = NetAddress.formatIp(server.address.address)
        // A wildcard bind also listens on loopback, which is all the tunnel needs to reach.
        const target =
          bound === "0.0.0.0" || bound === "::"
            ? `127.0.0.1:${server.address.port}`
            : NetAddress.formatInet(server.address)
        yield* Effect.forkScoped(
          RemoteTunnel.run({
            route: config.remote.route,
            target,
            onURL: (url) => {
              remote.urls = url === undefined ? [] : [url]
            },
          }),
        )
      }
      const url = HttpServer.formatAddress(server.address)
      console.log(options.mode === "stdio" ? JSON.stringify({ url }) : `server listening on ${url}`)
      if (foreground && !environmentPassword) console.log(`server password ${password}`)
      return yield* options.mode === "service"
        ? server.shutdown
        : options.mode === "stdio"
          ? waitForStdinClose()
          : Effect.never
    }).pipe(Effect.annotateLogs({ role: "server" })),
  )
})

function serviceURL(hostname: string, port: number) {
  return `http://${hostname.includes(":") ? `[${hostname}]` : hostname}:${port}`
}

function truthy(value?: string) {
  return value === "1" || value?.toLowerCase() === "true"
}

function addressInUse(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  if ("code" in error && error.code === "EADDRINUSE") return true
  return "cause" in error && addressInUse(error.cause)
}

function waitForStdinClose() {
  return Effect.callback<void>((resume) => {
    const close = () => resume(Effect.void)
    process.stdin.once("end", close)
    process.stdin.once("close", close)
    process.stdin.resume()
    if (process.stdin.readableEnded || process.stdin.destroyed) close()
    return Effect.sync(() => {
      process.stdin.off("end", close)
      process.stdin.off("close", close)
      process.stdin.pause()
    })
  })
}
