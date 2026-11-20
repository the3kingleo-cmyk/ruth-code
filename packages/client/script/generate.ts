import { NodeFileSystem } from "@effect/platform-node"
import { compile, emitEffectImported, emitEffectShape, emitPromise, write } from "@ruth/httpapi-codegen"
import {
  ClientApi,
  clientNamespace,
  effectOmitEndpoints,
  groupNames,
  promiseOmitEndpoints,
} from "@ruth/protocol/client"
import { Agent } from "@ruth/schema/agent"
import { Artifact } from "@ruth/schema/artifact"
import { Command } from "@ruth/schema/command"
import { Config } from "@ruth/schema/config"
import { Credential } from "@ruth/schema/credential"
import { Event } from "@ruth/schema/event"
import { EventLog } from "@ruth/schema/event-log"
import { FileDiff } from "@ruth/schema/file-diff"
import { FileSystem } from "@ruth/schema/filesystem"
import { Form } from "@ruth/schema/form"
import { Generate } from "@ruth/schema/generate"
import { Instruction } from "@ruth/schema/instruction"
import { InstructionEntry } from "@ruth/schema/instruction-entry"
import { Integration } from "@ruth/schema/integration"
import { Job } from "@ruth/schema/job"
import { Location } from "@ruth/schema/location"
import { Mcp } from "@ruth/schema/mcp"
import { Model } from "@ruth/schema/model"
import { Money } from "@ruth/schema/money"
import { Permission } from "@ruth/schema/permission"
import { PermissionSaved } from "@ruth/schema/permission-saved"
import { Plugin } from "@ruth/schema/plugin"
import { Project } from "@ruth/schema/project"
import { Worktree } from "@ruth/schema/worktree"
import { AgentAttachment, FileAttachment, Prompt, PromptMention } from "@ruth/schema/prompt"
import { PromptInput } from "@ruth/schema/prompt-input"
import { Provider } from "@ruth/schema/provider"
import { Pty } from "@ruth/schema/pty"
import { PtyTicket } from "@ruth/schema/pty-ticket"
import { Question } from "@ruth/schema/question"
import { Reference } from "@ruth/schema/reference"
import { AbsolutePath, RelativePath } from "@ruth/schema/schema"
import { Schedule } from "@ruth/schema/schedule"
import { Session } from "@ruth/schema/session"
import { SessionMessage } from "@ruth/schema/session-message"
import { SessionInbox } from "@ruth/schema/session-inbox"
import { Shell } from "@ruth/schema/shell"
import { Skill } from "@ruth/schema/skill"
import { Snapshot } from "@ruth/schema/snapshot"
import { Vcs } from "@ruth/schema/vcs"
import { WebSearch } from "@ruth/schema/websearch"
import { Workspace } from "@ruth/schema/workspace"
import { Effect, Schema } from "effect"
import { fileURLToPath } from "url"

const promiseContract = compile(ClientApi, {
  groupNames,
  omitEndpoints: promiseOmitEndpoints,
  namespace: clientNamespace,
  aliases: true,
})
const effectContract = compile(ClientApi, {
  groupNames,
  omitEndpoints: effectOmitEndpoints,
  namespace: clientNamespace,
  aliases: true,
})
const effectTypeReferences = [
  ...namespaceTypes("Agent", "@ruth/schema/agent", Agent),
  ...namespaceTypes("Artifact", "@ruth/schema/artifact", Artifact),
  ...namespaceTypes("Command", "@ruth/schema/command", Command),
  ...namespaceTypes("Config", "@ruth/schema/config", Config),
  ...namespaceTypes("Credential", "@ruth/schema/credential", Credential),
  ...namespaceTypes("Event", "@ruth/schema/event", Event),
  ...namespaceTypes("EventLog", "@ruth/schema/event-log", EventLog),
  ...namespaceTypes("FileDiff", "@ruth/schema/file-diff", FileDiff),
  ...namespaceTypes("FileSystem", "@ruth/schema/filesystem", FileSystem),
  ...namespaceTypes("Form", "@ruth/schema/form", Form),
  ...namespaceTypes("Generate", "@ruth/schema/generate", Generate),
  ...namespaceTypes("Instruction", "@ruth/schema/instruction", Instruction),
  ...namespaceTypes("InstructionEntry", "@ruth/schema/instruction-entry", InstructionEntry),
  ...namespaceTypes("Integration", "@ruth/schema/integration", Integration),
  ...namespaceTypes("Job", "@ruth/schema/job", Job),
  typeReference("Location.PublicRef", "@ruth/schema/location", Location.PublicRef),
  typeReference("Location.PublicInfo", "@ruth/schema/location", Location.PublicInfo),
  ...namespaceTypes("Mcp", "@ruth/schema/mcp", Mcp),
  ...namespaceTypes("Model", "@ruth/schema/model", Model),
  ...namespaceTypes("Money", "@ruth/schema/money", Money),
  ...namespaceTypes("Permission", "@ruth/schema/permission", Permission),
  ...namespaceTypes("PermissionSaved", "@ruth/schema/permission-saved", PermissionSaved),
  ...namespaceTypes("Plugin", "@ruth/schema/plugin", Plugin),
  ...namespaceTypes("Project", "@ruth/schema/project", Project),
  ...namespaceTypes("Worktree", "@ruth/schema/worktree", Worktree),
  ...namespaceTypes("PromptInput", "@ruth/schema/prompt-input", PromptInput),
  ...namespaceTypes("Provider", "@ruth/schema/provider", Provider),
  ...namespaceTypes("Pty", "@ruth/schema/pty", Pty),
  ...namespaceTypes("PtyTicket", "@ruth/schema/pty-ticket", PtyTicket),
  ...namespaceTypes("Question", "@ruth/schema/question", Question),
  ...namespaceTypes("Reference", "@ruth/schema/reference", Reference),
  ...namespaceTypes("Schedule", "@ruth/schema/schedule", Schedule),
  ...namespaceTypes("Session", "@ruth/schema/session", Session),
  ...namespaceTypes("SessionMessage", "@ruth/schema/session-message", SessionMessage),
  ...namespaceTypes("SessionInbox", "@ruth/schema/session-inbox", SessionInbox),
  ...namespaceTypes("Shell", "@ruth/schema/shell", Shell),
  ...namespaceTypes("Skill", "@ruth/schema/skill", Skill),
  ...namespaceTypes("Snapshot", "@ruth/schema/snapshot", Snapshot),
  ...namespaceTypes("Vcs", "@ruth/schema/vcs", Vcs),
  ...namespaceTypes("WebSearch", "@ruth/schema/websearch", WebSearch),
  ...namespaceTypes("Workspace", "@ruth/schema/workspace", Workspace),
  typeReference("Prompt", "@ruth/schema/prompt", Prompt),
  typeReference("PromptMention", "@ruth/schema/prompt", PromptMention),
  typeReference("FileAttachment", "@ruth/schema/prompt", FileAttachment),
  typeReference("AgentAttachment", "@ruth/schema/prompt", AgentAttachment),
  typeReference("AbsolutePath", "@ruth/schema/schema", AbsolutePath),
  typeReference("RelativePath", "@ruth/schema/schema", RelativePath),
]

await Effect.runPromise(
  Effect.all(
    [
      write(
        emitPromise(promiseContract, {
          mutableOutputs: true,
        }),
        fileURLToPath(new URL("../src/promise/generated", import.meta.url)),
      ),
      write(
        emitEffectImported(effectContract, {
          module: "../../contract",
          api: "ClientApi",
          shapeModule: "../api/api.js",
        }),
        fileURLToPath(new URL("../src/effect/generated", import.meta.url)),
      ),
      write(
        emitEffectShape(effectContract, {
          typeReferences: effectTypeReferences,
          outputTypes: {
            "event.subscribe": {
              name: "RuthEvent",
              import: 'import type { RuthEvent } from "@ruth/protocol/groups/event"',
            },
          },
        }),
        fileURLToPath(new URL("../src/effect/api", import.meta.url)),
      ),
    ],
    { concurrency: 3, discard: true },
  ).pipe(Effect.provide(NodeFileSystem.layer)),
)

function namespaceTypes(namespace: string, module: string, values: object) {
  return Object.entries(values).flatMap(([name, schema]) =>
    Schema.isSchema(schema) ? [typeReference(`${namespace}.${name}`, module, schema)] : [],
  )
}

function typeReference(name: string, module: string, schema: Schema.Top) {
  return {
    schema,
    name,
    import: `import type { ${name.split(".")[0]} } from ${JSON.stringify(module)}`,
  }
}
