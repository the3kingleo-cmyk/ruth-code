import { Option, Schema } from "effect"

declare const RUTH_VERSION: string
declare const RUTH_CHANNEL: string
declare const RUTH_ARTIFACT: string
declare const RUTH_RELEASE_HIGHLIGHTS: string

const version = typeof RUTH_VERSION === "string" ? RUTH_VERSION : "local"
const channel = typeof RUTH_CHANNEL === "string" ? RUTH_CHANNEL : "local"
const artifact = typeof RUTH_ARTIFACT === "string" ? RUTH_ARTIFACT : "cli"
// Stable release builds embed the release notes' Highlights; every other build has none.
const highlights =
  typeof RUTH_RELEASE_HIGHLIGHTS === "string"
    ? Option.getOrElse(
        Schema.decodeUnknownOption(
          Schema.fromJsonString(Schema.Array(Schema.Struct({ title: Schema.String, body: Schema.String }))),
        )(RUTH_RELEASE_HIGHLIGHTS),
        () => [],
      )
    : []

export {
  version as RUTH_VERSION,
  channel as RUTH_CHANNEL,
  artifact as RUTH_ARTIFACT,
  highlights as RUTH_HIGHLIGHTS,
}
export const RUTH_LOCAL = channel === "local"
