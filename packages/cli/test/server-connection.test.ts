import { NodeFileSystem, NodeServices } from "@effect/platform-node"
import { Global } from "@ruth/util/global"
import { RUTH_VERSION } from "../src/version"
import { expect, test } from "bun:test"
import { Console, Effect, FileSystem, Option, Scope } from "effect"
import { Command } from "effect/cli"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Commands, PrintLogs, Server, Standalone } from "../src/commands/commands"
import { Spec } from "../src/framework/spec"
import { ServerConnection } from "../src/services/server-connection"
import { ServiceConfig } from "../src/services/service-config"
import { isolatedEnv } from "./fixture/environment"

test("resolution groups Effect-native lifecycle operations only for the managed service", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ruth-server-resolution-"))
  const id = "server-resolution-test"
  const server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({
        version: RUTH_VERSION,
        pid: process.pid,
        urls: [],
      })
    },
  })
  const registration = path.join(root, "state", ServiceConfig.filename())
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  const runPromise = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem | Scope.Scope>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer), Effect.scoped))

  try {
    await fs.mkdir(path.dirname(registration), { recursive: true })
    await fs.writeFile(
      registration,
      JSON.stringify({
        id,
        version: RUTH_VERSION,
        url: server.url.toString(),
        pid: process.pid,
      }),
    )
    const resolved = await runPromise(ServerConnection.resolve())

    expect(resolved.endpoint.url).toBe(server.url.toString())
    expect(resolved.service).toBeDefined()
    if (!resolved.service) throw new Error("Expected managed service capabilities")
    expect(Effect.isEffect(resolved.service.reconnect())).toBe(true)
    expect(Effect.isEffect(resolved.service.restart())).toBe(true)
    expect(await runPromise(resolved.service.reconnect())).toEqual(resolved.endpoint)

    const existing = await runPromise(ServerConnection.resolve({ autostart: false }))
    expect(existing.endpoint.url).toBe(server.url.toString())
    expect(existing.service).toBeDefined()

    const explicit = await runPromise(ServerConnection.resolve({ server: server.url.toString() }))
    expect(explicit.endpoint.url).toBe(server.url.toString())
    expect(explicit.service).toBeUndefined()
  } finally {
    await server.stop(true)
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("service options only require a matching version when requested", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ruth-service-options-"))
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  const runPromise = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem | Scope.Scope>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer), Effect.scoped))

  try {
    expect((await runPromise(ServiceConfig.options())).version).toBeUndefined()
    expect((await runPromise(ServiceConfig.options({ checkVersion: true }))).version).toBe(RUTH_VERSION)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("global --server and --standalone flags parse in any position for server-connecting commands and reject on local-only commands", async () => {
  const captured: Array<{
    readonly path: string
    readonly server: string | undefined
    readonly standalone: boolean
  }> = []

  function bindTree(
    node: Spec.Any,
    prefix: ReadonlyArray<string> = [],
  ): Command.Command<string, unknown, unknown, unknown, never> {
    const currentPath = [...prefix, node.name].join(" ")
    const withHandler = node.spec.pipe(
      Command.withHandler((input: Record<string, unknown>) =>
        Effect.gen(function* () {
          const serverFlag = yield* Effect.serviceOption(Server).pipe(Effect.map(Option.flatten))
          const standaloneFlag = yield* Effect.serviceOption(Standalone)
          const inputServer = Option.isOption(input.server)
            ? Option.getOrUndefined(input.server as Option.Option<string>)
            : undefined
          const inputStandalone = typeof input.standalone === "boolean" ? input.standalone : undefined
          captured.push({
            path: currentPath,
            server: inputServer ?? Option.getOrUndefined(serverFlag),
            standalone: inputStandalone ?? Option.getOrElse(standaloneFlag, () => false),
          })
        }),
      ),
    ) as Command.Command<string, unknown, unknown, unknown, never>
    const children = Object.values(node.commands)
    if (children.length === 0) return withHandler
    return withHandler.pipe(
      Command.withSubcommands(children.map((child) => bindTree(child, [...prefix, node.name]))),
    ) as Command.Command<string, unknown, unknown, unknown, never>
  }

  const silentConsole: Console.Console = Object.assign(Object.create(console), {
    log: () => {},
    error: () => {},
  })

  const runArgs = (args: ReadonlyArray<string>) =>
    Effect.runPromise(
      Command.runWith(bindTree(Commands).pipe(Command.withGlobalFlags([PrintLogs])), {
        version: RUTH_VERSION,
        renderErrors: false,
      })(args).pipe(Effect.provideService(Console.Console, silentConsole), Effect.provide(NodeServices.layer)),
    )

  const url = "http://127.0.0.1:43210"
  const serverCases: ReadonlyArray<readonly [ReadonlyArray<string>, string]> = [
    [["--server", url, "session", "list"], "ruth session list"],
    [["session", "--server", url, "list"], "ruth session list"],
    [["session", "list", "--server", url], "ruth session list"],
    [["session", "--server", url, "delete", "ses_123"], "ruth session delete"],
    [["--server", url, "plugin", "list"], "ruth plugin list"],
    [["plugin", "--server", url, "list"], "ruth plugin list"],
    [["plugin", "list", "--server", url], "ruth plugin list"],
    [["plugin", "--server", url, "check"], "ruth plugin check"],
    [["plugin", "--server", url, "update"], "ruth plugin update"],
    [["--server", url, "mcp", "list"], "ruth mcp list"],
    [["mcp", "--server", url, "list"], "ruth mcp list"],
    [["mcp", "list", "--server", url], "ruth mcp list"],
    [["mcp", "--server", url, "auth", "linear"], "ruth mcp auth"],
    [["mcp", "--server", url, "logout", "linear"], "ruth mcp logout"],
    [["auth", "--server", url, "list"], "ruth auth list"],
    [["debug", "--server", url, "config"], "ruth debug config"],
    [["debug", "--server", url, "agents"], "ruth debug agents"],
    [["debug", "--server", url, "heap-dump"], "ruth debug heap-dump"],
    [["--server", url, "models"], "ruth models"],
    [["models", "--server", url], "ruth models"],
    [["--server", url, "run", "hello"], "ruth run"],
    [["run", "hello", "--server", url], "ruth run"],
  ]

  for (const [args, expectedPath] of serverCases) {
    captured.length = 0
    await runArgs(args)
    expect(captured).toEqual([{ path: expectedPath, server: url, standalone: false }])
  }

  captured.length = 0
  await runArgs(["session", "--standalone", "list"])
  expect(captured).toEqual([{ path: "ruth session list", server: undefined, standalone: true }])

  await expect(runArgs(["plugin", "add", "some-plugin", "--server", url])).rejects.toThrow()
  await expect(runArgs(["plugin", "remove", "some-plugin", "--server", url])).rejects.toThrow()
  await expect(runArgs(["mcp", "add", "my-mcp", "--url", "https://example.com/mcp", "--server", url])).rejects.toThrow()
  await expect(runArgs(["serve", "--server", url])).rejects.toThrow()
  await expect(runArgs(["--server", url, "serve"])).rejects.toThrow()
  await expect(runArgs(["service", "status", "--server", url])).rejects.toThrow()
  await expect(runArgs(["service", "--server", url, "start"])).rejects.toThrow()
})

test("local config commands do not start or require a server", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ruth-local-config-cmd-"))
  try {
    const env = isolatedEnv(root)
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        path.join(import.meta.dir, "../src/index.ts"),
        "mcp",
        "add",
        "demo",
        "--global",
        "--url",
        "https://example.com/mcp",
      ],
      {
        cwd: path.join(import.meta.dir, ".."),
        env,
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" })
    expect(stdout).toContain('MCP server "demo" added')
    const config = await Bun.file(path.join(root, "config", "ruth.json")).json()
    expect(config).toMatchObject({
      mcp: {
        servers: {
          demo: { type: "remote", url: "https://example.com/mcp" },
        },
      },
    })
    expect(await Bun.file(path.join(root, "state", "ruth", ServiceConfig.filename())).exists()).toBe(false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
