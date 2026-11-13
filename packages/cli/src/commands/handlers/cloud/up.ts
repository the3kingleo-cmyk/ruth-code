import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { cloudUp } from "../../../cloud"

export default Runtime.handler(
  Commands.commands.cloud.commands.up,
  Effect.fn("cli.cloud.up")(function* (args) {
    const result = yield* Effect.tryPromise({
      try: () =>
        cloudUp({
          repo: Option.getOrUndefined(args.repo),
          machine: args.machine,
          localPort: args.localPort,
          idleTimeout: args.idleTimeout,
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    })
    process.stdout.write(result.detail + "\n")
    if (!result.ok) return yield* Effect.fail(new Error(result.detail))
  }),
)
