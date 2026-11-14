import type { RuthEvent } from "@ruth/client"
import type { SelectedEvent, SubscribeOptions } from "@ruth/client/promise/api"

type EventType = Exclude<RuthEvent["type"], "server.connected">

export interface EventDomain {
  readonly subscribe: <Type extends EventType = EventType>(
    options?: SubscribeOptions<Type>,
  ) => AsyncIterable<SelectedEvent<RuthEvent, Type>>
}
