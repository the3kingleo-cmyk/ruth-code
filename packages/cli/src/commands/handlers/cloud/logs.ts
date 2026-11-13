import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { cloudLogs } from "../../../cloud"

export default Runtime.handler(
  Commands.commands.cloud.commands.logs,
  Effect.fn("cli.cloud.logs")(function* () {
    const result = cloudLogs()
    process.stdout.write(result.detail + "\n")
    if (!result.ok) return yield* Effect.fail(new Error(result.detail))
  }),
)
