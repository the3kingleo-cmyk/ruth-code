import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { cloudDown } from "../../../cloud"

export default Runtime.handler(
  Commands.commands.cloud.commands.down,
  Effect.fn("cli.cloud.down")(function* () {
    const result = cloudDown()
    process.stdout.write(result.detail + "\n")
    if (!result.ok) return yield* Effect.fail(new Error(result.detail))
  }),
)
