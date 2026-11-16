import fs from "fs"

/** Linux MemAvailable in KiB, or undefined when /proc/meminfo is missing. */
export function readMemAvailableKiB(source?: string): number | undefined {
  const text =
    source ??
    (process.platform === "linux"
      ? (() => {
          try {
            return fs.readFileSync("/proc/meminfo", "utf8")
          } catch {
            return undefined
          }
        })()
      : undefined)
  if (!text) return undefined
  const match = text.match(/^MemAvailable:\s+(\d+)\s+kB/m)
  if (!match) return undefined
  return Number(match[1])
}

export const LOW_MEMORY_KIB = 768 * 1024

export function isLowMemory(memAvailableKiB = readMemAvailableKiB()): boolean {
  return memAvailableKiB !== undefined && memAvailableKiB < LOW_MEMORY_KIB
}
