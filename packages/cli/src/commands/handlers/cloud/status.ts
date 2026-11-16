import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { cloudStatus, formatCloudStatus } from "../../../cloud"

export default Runtime.handler(
  Commands.commands.cloud.commands.status,
  Effect.fn("cli.cloud.status")(function* () {
    process.stdout.write(formatCloudStatus(cloudStatus()) + "\n")
  }),
)
