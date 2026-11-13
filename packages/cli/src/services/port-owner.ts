import { AppProcess } from "@opencode/util/process"
import { Effect } from "effect"
import { ChildProcess } from "effect/process"
import net from "node:net"

export * as PortOwner from "./port-owner"

export type Info = {
  readonly pid: number
  readonly command: string
}

const MANAGED_BIN = /^(ruth|opencode|jcode)$/i

/** True when the listening process is a Ruth, OpenCode, or JCode binary — including a stale service. */
export function isManagedService(command: string) {
  const first = command.trim().split(/\s+/)[0] ?? ""
  const base = first.replace(/\\/g, "/").split("/").pop() ?? ""
  return MANAGED_BIN.test(base.replace(/['"]/g, ""))
}

export const inspect = Effect.fnUntraced(function* (port: number, hostname?: string) {
  if (process.platform === "win32") return undefined
  const appProcess = yield* AppProcess.Service
  const run = (command: string, args: ReadonlyArray<string>) =>
    appProcess
      .run(ChildProcess.make(command, args, { stdin: "ignore", killSignal: "SIGKILL" }), {
        timeout: "1 second",
        maxOutputBytes: 16_384,
      })
      .pipe(
        Effect.map((result) => (result.exitCode === 0 ? result.stdout.toString("utf8") : "")),
        Effect.orElseSucceed(() => ""),
      )

  const fromSs = parseSs(yield* run("ss", ["-ltnp", `sport = :${port}`]), hostname)
  const fromLsof =
    fromSs ??
    listeners(yield* run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpn"])).find((listener) =>
      matches(listener.address, hostname),
    )
  const fromFuser = fromLsof ?? firstPid(yield* run("fuser", ["-n", "tcp", String(port)]))
  const pid = fromSs?.pid ?? (fromLsof ? Number(fromLsof.pid) : fromFuser)
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) return undefined

  const command =
    (yield* run("ps", ["-o", "command=", "-p", String(pid)])).replace(/\s+/g, " ").trim() ||
    fromSs?.name ||
    ""
  return { pid, command }
})

export const describe = Effect.fnUntraced(function* (port: number, hostname?: string) {
  const owner = yield* inspect(port, hostname)
  if (owner === undefined) return undefined
  if (!owner.command) return `PID ${owner.pid}`
  const command = owner.command
  return `PID ${owner.pid} (${command.length > 200 ? command.slice(0, 199) + "…" : command})`
})

export const waitUntilFree = Effect.fnUntraced(function* (port: number, hostname?: string) {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    if ((yield* inspect(port, hostname)) === undefined) return true
    yield* Effect.sleep("50 millis")
  }
  return (yield* inspect(port, hostname)) === undefined
})

/** Stop a process that still holds our managed port. Never signals this process. */
export const terminate = Effect.fnUntraced(function* (pid: number) {
  if (pid === process.pid) return
  yield* signal(pid, "SIGTERM")
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (!(yield* alive(pid))) return
    yield* Effect.sleep("50 millis")
  }
  yield* signal(pid, "SIGKILL")
  const killDeadline = Date.now() + 2_000
  while (Date.now() < killDeadline) {
    if (!(yield* alive(pid))) return
    yield* Effect.sleep("50 millis")
  }
})

const signal = (pid: number, name: NodeJS.Signals) =>
  Effect.try({ try: () => process.kill(pid, name), catch: () => undefined }).pipe(Effect.ignore)

const alive = (pid: number) =>
  Effect.sync(() => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  })

function parseSs(output: string, hostname?: string) {
  for (const line of output.split("\n")) {
    if (!line.includes("LISTEN")) continue
    const users = /users:\(\("([^"]*)",pid=(\d+)/.exec(line)
    if (!users) continue
    const local = /([\[\]0-9a-fA-F.:*]+):(\d+)\s+[^\s]+:/.exec(line)
    const address = local?.[1]?.replace(/^\[(.*)\]$/, "$1") ?? "*"
    if (local && !matches(address, hostname)) continue
    return { pid: Number(users[2]), name: users[1] ?? "" }
  }
  return undefined
}

function firstPid(output: string) {
  const pid = output.match(/\d+/)?.[0]
  return pid ? Number(pid) : undefined
}

function listeners(output: string) {
  const found: { pid: string; address: string }[] = []
  let pid: string | undefined
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = /^\d+$/.test(line.slice(1)) ? line.slice(1) : undefined
    if (line.startsWith("n") && pid !== undefined)
      found.push({ pid, address: line.slice(1, line.lastIndexOf(":")).replace(/^\[(.*)\]$/, "$1") })
  }
  return found
}

// lsof shows wildcard listeners as `*`; those also hold the port for any specific address.
function matches(address: string, hostname: string | undefined) {
  const host = hostname?.replace(/^\[(.*)\]$/, "$1")
  if (host === undefined || net.isIP(host) === 0 || host === "0.0.0.0" || host === "::") return true
  return address === "*" || address === host
}
