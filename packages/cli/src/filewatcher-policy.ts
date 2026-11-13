import { env } from "@opencode/util/env"
import { isLowMemory, readMemAvailableKiB } from "@opencode/util/meminfo"

function truthy(value: string | undefined): boolean {
  if (value === undefined) return false
  const normalized = value.trim().toLowerCase()
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on"
}

/** File watcher stays on unless the user disabled it or available memory is low. */
export function shouldEnableFilewatcher(memAvailableKiB = readMemAvailableKiB()): {
  enabled: boolean
  reason: "explicit-off" | "explicit-on" | "low-memory" | "default-on"
} {
  const explicit = env("FILEWATCHER_DISABLE") ?? env("DISABLE_FILEWATCHER")
  if (explicit !== undefined && explicit !== "") {
    const enabled = !truthy(explicit)
    return { enabled, reason: enabled ? "explicit-on" : "explicit-off" }
  }
  if (isLowMemory(memAvailableKiB)) return { enabled: false, reason: "low-memory" }
  return { enabled: true, reason: "default-on" }
}
