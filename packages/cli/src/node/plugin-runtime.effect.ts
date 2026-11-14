import {
  Agent,
  Command,
  Connection,
  Credential,
  Integration,
  Model,
  Plugin,
  Provider,
  Reference,
  Skill,
} from "@ruth/plugin/effect"
import { Tool } from "@ruth/schema/tool"

const key = Symbol.for("ruth.plugin.v2.effect")
;(globalThis as typeof globalThis & { [key]?: unknown })[key] = {
  Agent,
  Command,
  Connection,
  Credential,
  Integration,
  Model,
  Plugin,
  Provider,
  Reference,
  Skill,
  Tool: { Error: Tool.Error },
}
