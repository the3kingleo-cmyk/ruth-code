import fs from "node:fs"
import path from "node:path"
import { RUTH_CHANNEL } from "./version"

function channelDbName(prefix: string) {
  return ["latest", "dev", "beta", "next", "prod"].includes(RUTH_CHANNEL) ||
    process.env.RUTH_DISABLE_CHANNEL_DB === "1" ||
    process.env.RUTH_DISABLE_CHANNEL_DB === "true" ||
    process.env.RUTH_DISABLE_CHANNEL_DB === "1" ||
    process.env.RUTH_DISABLE_CHANNEL_DB === "true"
    ? `${prefix}.db`
    : `${prefix}-${RUTH_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`
}

export function databasePath(data: string) {
  const override = process.env.RUTH_DB
  if (override === ":memory:") return override
  if (override) return path.resolve(data, override)

  const filename = channelDbName("ruth")
  const resolved = path.resolve(data, filename)
  if (!fs.existsSync(resolved)) {
    const legacy = path.resolve(data, channelDbName("ruth"))
    if (legacy !== resolved && fs.existsSync(legacy)) {
      try {
        fs.renameSync(legacy, resolved)
      } catch {
        return legacy
      }
    }
  }
  return resolved
}
