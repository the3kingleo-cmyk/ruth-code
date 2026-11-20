import { CrossSpawnSpawner } from "@ruth/util/cross-spawn-spawner"
import { LayerNode } from "@ruth/util/effect/layer-node"
import { Deferred, Effect, Ref, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { randomBytes } from "node:crypto"
import { selfCommand } from "../util/process"

const Ready = Schema.Struct({ url: Schema.String })
const decodeReady = Schema.decodeUnknownPromise(Schema.fromJsonString(Ready))

type Options = {
  readonly command?: ReadonlyArray<string>
}

const startupDirectory = process.cwd()

function command(password: string, options: Options) {
  const [executable, ...args] = options.command ?? [...selfCommand(), "serve"]
  if (!executable) throw new Error("Failed to resolve standalone server command")
  return ChildProcess.make(executable, [...args, "--stdio", "--port", "0"], {
    cwd: startupDirectory,
    // Explicit entry wins over anything inherited, so a user-exported
    // RUTH_PASSWORD cannot shadow the child's lease credential.
    env: { RUTH_PASSWORD: password },
    extendEnv: true,
    // The server treats EOF on this pipe as the end of its ownership lease.
    // The OS closes it even when the TUI is killed before Effect finalizers run.
    stdin: "pipe",
    stderr: process.env.RUTH_PRINT_LOGS === "1" ? "inherit" : "pipe",
    killSignal: "SIGTERM",
    forceKillAfter: "3 seconds",
  })
}

const makeEndpoint = Effect.fn("cli.standalone.endpoint")(
  function* (options: Options) {
    const password = randomBytes(32).toString("base64url")
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const proc = yield* spawner.spawn(command(password, options))
    const readyLine = yield* Deferred.make<string, Error>()
    const stderrText = yield* Ref.make("")
    if (proc.stderr) {
      yield* proc.stderr.pipe(
        Stream.decodeText(),
        Stream.runForEach((chunk) => Ref.update(stderrText, (s) => s + chunk)),
        Effect.catch(() => Effect.void),
        Effect.forkScoped,
      )
    }
    const readinessError = Effect.gen(function* () {
      yield* Effect.sleep("50 millis")
      const logs = (yield* Ref.get(stderrText)).trim()
      const suffix = logs ? `\n${logs}` : ""
      return yield* Deferred.fail(
        readyLine,
        new Error(`Standalone server exited before reporting readiness${suffix}`),
      )
    })
    // Keep draining stdout after readiness so later server writes cannot hit EPIPE.
    yield* proc.stdout.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) => Deferred.succeed(readyLine, line)),
      Effect.ensuring(readinessError),
      Effect.forkScoped,
    )
    const output = yield* Deferred.await(readyLine)
    const ready = yield* Effect.tryPromise(() => decodeReady(output))
    return {
      url: ready.url,
      auth: { type: "basic" as const, username: "ruth", password },
      pid: proc.pid,
      exited: proc.exitCode,
    }
  },
  Effect.provide(LayerNode.compile(CrossSpawnSpawner.node)),
)

export function start(options: Options = {}) {
  return makeEndpoint(options)
}

export * as Standalone from "./standalone"
