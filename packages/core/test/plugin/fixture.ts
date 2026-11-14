import { Agent } from "@ruth/core/agent"
import { App } from "@ruth/core/app"
import { Artifact } from "@ruth/core/artifact"
import { AISDK } from "@ruth/core/aisdk"
import { Command } from "@ruth/core/command"
import { Config } from "@ruth/core/config"
import { Credential } from "@ruth/core/credential"
import { Database } from "@ruth/core/database/database"
import { Environment } from "@ruth/core/environment/index"
import { FileAccess } from "@ruth/core/file-access"
import { Flag } from "@ruth/core/flag"
import { LayerNodePlatform } from "@ruth/util/effect/app-node-platform"
import { AppProcess } from "@ruth/util/process"
import { LayerNode } from "@ruth/util/effect/layer-node"
import { Bus } from "@ruth/core/bus"
import { FileSystem } from "@ruth/core/filesystem"
import { FSUtil } from "@ruth/util/fs-util"
import { Global } from "@ruth/util/global"
import { Form } from "@ruth/core/form"
import { Generate } from "@ruth/core/generate"
import { InstructionDiscovery } from "@ruth/core/instruction-discovery"
import { Integration } from "@ruth/core/integration"
import { Job } from "@ruth/core/job"
import { KV } from "@ruth/core/kv"
import { Location } from "@ruth/core/location"
import { Mcp } from "@ruth/core/mcp/index"
import { Model } from "@ruth/core/model"
import { Npm } from "@ruth/util/npm"
import { Plugin } from "@ruth/core/plugin"
import { PluginHooks } from "@ruth/core/plugin/hooks"
import { Provider } from "@ruth/core/provider"
import { Session } from "@ruth/core/session"
import { SharedCache } from "@ruth/core/shared-cache"
import { InstructionEntry } from "@ruth/core/session/instruction-entry"
import { PersistentPty } from "@ruth/core/persistent-pty"
import { LocationServiceMap } from "@ruth/core/location-service-map"
import { AppNodeBuilder } from "@ruth/core/effect/app-node-builder"
import { Permission } from "@ruth/core/permission"
import { Reference } from "@ruth/core/reference"
import { Rpc } from "@ruth/core/rpc"
import { Skill } from "@ruth/core/skill"
import { SkillDiscovery } from "@ruth/core/skill/discovery"
import { Watcher } from "@ruth/core/filesystem/watcher"
import { Tool } from "@ruth/core/tool"
import { Vcs } from "@ruth/core/vcs"
import { WebSearch } from "@ruth/core/websearch"
import { Worktree } from "@ruth/core/worktree"
import { WorktreeStrategies } from "@ruth/core/worktree/strategies"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"
import { emptyMcpLayer } from "../fixture/mcp"
import { offlineModels } from "../fixture/models"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: (name) => Effect.succeed({ directory: "", name }),
    resolve: (name) => Effect.succeed({ directory: "", name }),
    check: () => Effect.succeed(false),
    update: (name) => Effect.succeed({ directory: "", name }),
    which: () => Effect.undefined,
  }),
)

const generateLayer = Layer.succeed(
  Generate.Service,
  Generate.Service.of({
    text: () => Effect.succeed(""),
    image: () => Effect.die("unused"),
    decisions: () => Effect.die("unused"),
  }),
)

const configLayer = Config.testLayer()

const permissionLayer = Layer.succeed(
  Permission.Service,
  Permission.Service.of({
    close: Effect.void,
    ask: (input) => Effect.succeed({ id: input.id ?? Permission.ID.create(), effect: "ask" }),
    assert: () => Effect.void,
    assertNotDenied: () => Effect.void,
    allows: () => Effect.succeed(false),
    reply: () => Effect.void,
    get: () => Effect.succeed(undefined),
    forSession: () => Effect.succeed([]),
    list: () => Effect.succeed([]),
  }),
)

export const makePluginTestLayer = (permission = permissionLayer, generate = generateLayer) =>
  AppNodeBuilder.build(
    LayerNode.group([
      App.node,
      AppProcess.node,
      FileSystem.node,
      FSUtil.node,
      Location.node,
      Npm.node,
      Credential.node,
      Config.node,
      Flag.node,
      Database.node,
      Environment.node,
      FileAccess.node,
      Global.node,
      Bus.node,
      Form.node,
      Generate.node,
      LayerNodePlatform.httpClient,
      Plugin.node,
      Agent.node,
      Artifact.node,
      AISDK.node,
      Provider.node,
      Model.node,
      Command.node,
      InstructionDiscovery.node,
      Integration.node,
      Job.node,
      KV.node,
      Mcp.node,
      Session.node,
      SharedCache.node,
      InstructionEntry.node,
      PersistentPty.node,
      LocationServiceMap.node,
      Permission.node,
      PluginHooks.node,
      Reference.node,
      Rpc.node,
      Skill.node,
      SkillDiscovery.node,
      Tool.node,
      Vcs.node,
      Watcher.node,
      WebSearch.node,
      Worktree.node,
      WorktreeStrategies.node,
    ]),
    [
      Location.node.replace(tempLocationLayer),
      Npm.node.replace(npmLayer),
      Config.node.replace(configLayer),
      Mcp.node.replace(emptyMcpLayer),
      Generate.node.replace(generate),
      Permission.node.replace(permission),
      offlineModels,
    ],
  ).pipe(Layer.provideMerge(configLayer))

export const PluginTestLayer = makePluginTestLayer()
