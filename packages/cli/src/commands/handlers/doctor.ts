import { Effect } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { formatDoctorReport, runDoctor } from "../../doctor"

export default Runtime.handler(
  Commands.commands.doctor,
  Effect.fn("cli.doctor")(function* (input) {
    const report = runDoctor({ repair: input.repair !== false })
    process.stdout.write(formatDoctorReport(report) + "\n")
    if (!report.ok) return yield* Effect.fail(new Error("ruth doctor found problems"))
  }),
)
