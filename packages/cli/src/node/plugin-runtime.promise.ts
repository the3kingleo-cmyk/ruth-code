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
} from "@ruth/plugin"

const key = Symbol.for("ruth.plugin.v2.promise")
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
}
