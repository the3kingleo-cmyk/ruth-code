import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@ruth/core/database/database"
import { AppNodeBuilder } from "@ruth/core/effect/app-node-builder"
import { LayerNode } from "@ruth/util/effect/layer-node"
import { Bus } from "@ruth/core/bus"
import { Location } from "@ruth/core/location"
import { Project } from "@ruth/core/project"
import { AbsolutePath } from "@ruth/core/schema"
import { Session } from "@ruth/core/session"
import { SessionProjector } from "@ruth/core/session/projector"
import { SessionExecution } from "@ruth/core/session/execution"
import { SessionStore } from "@ruth/core/session/store"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const awaited: Session.ID[] = []
const execution = Layer.mock(SessionExecution.Service, {
  awaitIdle: (sessionID) => Effect.sync(() => awaited.push(sessionID)),
})
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [Project.node.replace(globalProjectNode), SessionExecution.node.replace(execution)],
  ),
)

describe("Session.wait", () => {
  it.effect("delegates to SessionExecution.awaitIdle", () =>
    Effect.gen(function* () {
      awaited.length = 0
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location })

      yield* sessions.wait(session.id)

      expect(awaited).toEqual([session.id])
    }),
  )
})
