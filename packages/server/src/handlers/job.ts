import { Job } from "@ruth/core/job"
import { Session } from "@ruth/core/session"
import { SessionBackground } from "@ruth/core/session/background"
import type { ListQuery } from "@ruth/protocol/groups/job"
import { Effect, Option } from "effect"
import { missingSession } from "./session-error"

/** `job.*` in the `server.experimental` group. */
export const makeJob = Effect.gen(function* () {
  const jobs = yield* Job.Service
  const sessions = yield* Session.Service
  const lookup = {
    get: (sessionID: Session.ID) => sessions.get(sessionID).pipe(Effect.option, Effect.map(Option.getOrUndefined)),
  }

  return {
    list: Effect.fn("JobHandler.list")(function* (query: ListQuery) {
      if (query.sessionID !== undefined) {
        yield* sessions.get(query.sessionID).pipe(Effect.catchTag("Session.NotFoundError", missingSession))
      }
      return {
        data: yield* SessionBackground.list(jobs, lookup, query),
      }
    }),
  }
})
