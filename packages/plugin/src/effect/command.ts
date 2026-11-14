import type { CommandApi } from "@ruth/client/effect/api"
import type { PromptInput } from "@ruth/schema/prompt-input"
import type { Session } from "@ruth/schema/session"
import type { SessionInbox } from "@ruth/schema/session-inbox"
import type { Effect } from "effect"
import type { Transform } from "./registration.js"

export interface CommandInvocation {
  readonly sessionID: Session.ID
  readonly prompt: PromptInput.Prompt
  readonly delivery: SessionInbox.Delivery
}

export interface CommandDefinition {
  readonly name: string
  readonly description?: string
  readonly execute: (input: CommandInvocation) => Effect.Effect<void, unknown>
}

export interface CommandEditor {
  add(definition: CommandDefinition): void
}

export interface CommandDomain extends Pick<CommandApi<unknown>, "list"> {
  readonly transform: Transform<CommandEditor>
  readonly reload: () => Effect.Effect<void>
}
