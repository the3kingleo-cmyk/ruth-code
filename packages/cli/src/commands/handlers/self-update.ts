import { intro, log, outro, spinner } from "@clack/prompts"
import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { runningBinary, selfUpdate } from "../../self-update"
import { RUTH_VERSION } from "../../version"

export default Runtime.handler(
  Commands.commands["self-update"],
  Effect.fn("cli.self-update")(function* (input) {
    intro("Self-update")
    const progress = spinner()
    progress.start("Checking the3kingleo-cmyk/ruth-code releases...")
    const result = yield* Effect.promise(() =>
      selfUpdate({
        currentVersion: RUTH_VERSION,
        currentBinary: runningBinary(),
        target: Option.getOrUndefined(input.target),
        chatCheck: !input.skipChat,
      }),
    )
    if (!result.ok) {
      progress.stop("Self-update failed", 1)
      log.error(result.detail)
      outro("Failed")
      return yield* Effect.fail(new Error(result.detail))
    }
    progress.stop(result.action === "already-latest" ? "Already up to date" : "Update complete")
    log.info(result.detail)
    outro("Done")
  }),
)
