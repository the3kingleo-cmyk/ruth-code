export * as GlobTool from "./glob.js"

import { ToolFailure } from "@ruth/ai/effect"
import type { Context } from "@ruth/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import path from "path"
import { toolFailure } from "../runtime.js"
import { ToolSearch } from "../search.js"
import { Environment } from "../../environment/index.js"
import { FileSystem } from "../../filesystem.js"
import { Location } from "../../location.js"
import { FileAccess } from "../../file-access.js"
import { Ripgrep } from "../../ripgrep.js"
import { RelativePath } from "../../schema.js"
import { Permission } from "../../permission.js"

export const name = "glob"

export const Input = Schema.Struct({
  pattern: Schema.optionalKey(Schema.String).annotate({
    description: 'Glob pattern to match files. Use "*" to list every file in the folder.',
  }),
  path: Schema.optionalKey(RelativePath).annotate({
    description: "Directory to search. Defaults to the current working directory.",
  }),
  hidden: FileSystem.GlobInput.fields.hidden.annotate({
    description: "Include hidden files and directories (default: false).",
  }),
  limit: FileSystem.GlobInput.fields.limit.annotate({
    description: `Maximum number of matching files to return (default: ${FileSystem.DEFAULT_SEARCH_LIMIT})`,
  }),
})

export const Output = Schema.Array(FileSystem.Entry)
type EncodedOutput = typeof Output.Encoded

/** Format raw search results into the concise line-oriented output models expect. */
export const toModelContent = (entries: EncodedOutput, truncated = false) => {
  const lines = entries.length === 0 ? ["No files found"] : entries.map((item) => item.path)
  if (truncated)
    lines.push(
      "",
      `(Results are truncated: showing first ${entries.length} results. Consider using a more specific path or pattern.)`,
    )
  return lines.join("\n")
}

/** Glob leaf that defaults its filesystem root to the active Location. */

function normalizeGlobPath(path: string | undefined) {
  if (!path || path === "." || path === "./") return undefined
  if (path === "/" || path === "//" || path === "/think" || path === "/no_think") return undefined
  return path
}

function normalizeGlobPattern(pattern: string) {
  const raw = pattern.trim() || "*"
  if (raw === "." || raw === "./" || raw === "/*" || raw === "//*" || raw === "/**" || raw === "/**/*" || raw === "*/*")
    return "*"
  if (/^\/+$/.test(raw)) return "*"
  return raw.replace(/^\/+/, "") || "*"
}

export const Plugin = {
  id: "ruth.tool.glob",
  effect: Effect.fn("GlobTool.Plugin")(function* (ctx: Context) {
    const environment = yield* Environment.Service
    const ripgrep = yield* Ripgrep.Service
    const location = yield* Location.Service
    const access = yield* FileAccess.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description: 'List files in a folder or find paths matching a glob pattern (examples: "*", "**/*", "*.md", "src/**/*.tsx"). Use this, or shell ls, to list a directory. This is not a content search.',
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const searchPath = normalizeGlobPath(input.path === "undefined" || input.path === "null" ? undefined : input.path)
              const pattern = normalizeGlobPattern(input.pattern ?? "*")
              const target = yield* access.resolve({ path: searchPath ?? ".", kind: "directory" })
              yield* access.authorizeExternal([target], context)
              yield* permission.assert({
                action: name,
                resources: [pattern],
                save: ["*"],
                metadata: {
                  root: searchPath ?? ".",
                  path: searchPath,
                  hidden: input.hidden,
                  limit: input.limit,
                },
                ...Permission.invocation(context),
              })
              const type = yield* ToolSearch.pathType(environment.files, target.absolute, searchPath ?? ".")
              if (type !== "directory")
                return yield* Effect.fail(
                  new ToolFailure({ message: `Search path is not a directory: ${searchPath ?? "."}` }),
                )
              const root = target.absolute
              const result = yield* ToolSearch.bounded(input.limit ?? FileSystem.DEFAULT_SEARCH_LIMIT, (limit) =>
                ripgrep.glob({ cwd: root, pattern, hidden: input.hidden, limit }),
              )
              return {
                entries: result.items.map((entry) =>
                  FileSystem.Entry.make({
                    ...entry,
                    path: RelativePath.make(path.relative(location.directory, path.resolve(root, entry.path))),
                  }),
                ),
                truncated: result.truncated,
              }
            }).pipe(
              Effect.map((result) => ({
                output: result.entries,
                content: toModelContent(
                  result.entries.map((entry) => ({ ...entry, path: path.resolve(location.directory, entry.path) })),
                  result.truncated,
                ),
                metadata: { count: result.entries.length, truncated: result.truncated },
              })),
              Effect.mapError(toolFailure(`Unable to find files matching ${input.pattern ?? "*"}`)),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
