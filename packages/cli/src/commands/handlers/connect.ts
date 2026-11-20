import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { connect, formatConnect } from "../../connect"

export default Runtime.handler(
  Commands.commands.connect,
  Effect.fn("cli.connect")(function* (input) {
    const result = yield* Effect.promise(() =>
      connect({
        url: Option.getOrUndefined(input.url),
        model: Option.getOrUndefined(input.model),
        apiKey: Option.getOrUndefined(input.apiKey),
      }).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : String(error) }),
      ),
    )
    if (!result.ok) {
      process.stderr.write(`${result.message}\n`)
      process.exitCode = 1
      return
    }
    process.stdout.write(formatConnect(result.value) + "\n")
    if (result.value.type === "not-found") process.exitCode = 1
  }),
)
