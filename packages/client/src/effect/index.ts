// TODO: Keep additional network capabilities inside Schema and Protocol as the client grows; /effect must never import
// Core or Server. Preserve these datatype exports so internal model reorganizations do not require caller migrations.
import type { Effect } from "effect"
import type { Ruth } from "./client.js"

export * from "./generated/index"
export { Ruth } from "./client.js"
export type {
  AgentApi,
  AppApi,
  CommandApi,
  ConfigApi,
  EventApi,
  IntegrationApi,
  ModelApi,
  PluginApi,
  ProviderApi,
  ReferenceApi,
  RpcApi,
  RpcClient,
  WebSearchApi,
  SessionApi,
  SkillApi,
} from "./api.js"
export { Agent } from "@ruth/schema/agent"
export { Command } from "@ruth/schema/command"
export { Config } from "@ruth/schema/config"
export { Credential } from "@ruth/schema/credential"
export { Event } from "@ruth/schema/event"
export { EventLog } from "@ruth/schema/event-log"
export { FileSystem } from "@ruth/schema/filesystem"
export { Form } from "@ruth/schema/form"
export { Integration } from "@ruth/schema/integration"
export { Location } from "@ruth/schema/location"
export { Model } from "@ruth/schema/model"
export { Permission } from "@ruth/schema/permission"
export { PermissionSaved } from "@ruth/schema/permission-saved"
export { Project } from "@ruth/schema/project"
export { Worktree } from "@ruth/schema/worktree"
export { Vcs } from "@ruth/schema/vcs"
export { Provider } from "@ruth/schema/provider"
export { Pty } from "@ruth/schema/pty"
export { Question } from "@ruth/schema/question"
export { Reference } from "@ruth/schema/reference"
export { WebSearch } from "@ruth/schema/websearch"
export { AbsolutePath, RelativePath } from "@ruth/schema/schema"
export { Session } from "@ruth/schema/session"
export { SessionInbox } from "@ruth/schema/session-inbox"
export { SessionMessage } from "@ruth/schema/session-message"
export { Skill } from "@ruth/schema/skill"
export { Prompt } from "@ruth/schema/prompt"
export { PromptInput } from "@ruth/schema/prompt-input"
export type { RuthEvent } from "@ruth/protocol/groups/event"
export type RuthClient = Effect.Success<ReturnType<typeof Ruth.make>>
