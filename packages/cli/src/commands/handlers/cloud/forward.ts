import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { runForwardLoopSync } from "../../../cloud"

export default Runtime.handler(
  Commands.commands.cloud.commands.forward,
  Effect.fn("cli.cloud.forward")(function* (args) {
    runForwardLoopSync({
      codespace: args.codespace,
      localPort: args.localPort,
      remotePort: args.remotePort,
    })
  }),
)
