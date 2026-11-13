export type Policy = "disable" | "notify" | "auto"
export type Action = "none" | "notify" | "auto"

const maximumComponent = "9007199254740991"
const versionPattern =
  /^v?([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
/** Trailing build stamp, e.g. 202611132109 in 0.0.0-main-202611132109 or 0.0.0-202611132109. */
const stampPattern = /(?:^|-)(\d{12})$/

export function action(current: string, latest: string, policy: Policy): Action {
  if (policy === "disable") return "none"
  const currentVersion = parseReleaseVersion(current)
  const latestVersion = parseReleaseVersion(latest)
  if (!currentVersion || !latestVersion) return "none"
  if (sameRelease(currentVersion, latestVersion)) return "none"
  // Stamp-based preview builds: only offer an update when the latest stamp is newer.
  const currentStamp = releaseStamp(currentVersion)
  const latestStamp = releaseStamp(latestVersion)
  if (currentStamp && latestStamp && currentVersion.core === latestVersion.core) {
    return latestStamp > currentStamp ? policy : "none"
  }
  return policy
}

export function parseReleaseVersion(input: string) {
  if (input.length > 256) return
  const match = input.trim().match(versionPattern)
  if (!match) return
  if ([match[1], match[2], match[3]].some(invalidComponent)) return
  if (
    match[4]
      ?.split(".")
      .some((identifier) => identifier.length > 1 && identifier.startsWith("0") && /^[0-9]+$/.test(identifier))
  )
    return
  return {
    major: match[1],
    core: `${match[1]}.${match[2]}.${match[3]}`,
    prerelease: match[4]?.split(".") ?? [],
  }
}

function releaseStamp(version: NonNullable<ReturnType<typeof parseReleaseVersion>>) {
  const joined = version.prerelease.join(".")
  const match = joined.match(stampPattern)
  return match?.[1]
}

function sameRelease(current: NonNullable<ReturnType<typeof parseReleaseVersion>>, latest: typeof current) {
  if (current.core !== latest.core) return false
  const currentStamp = releaseStamp(current)
  const latestStamp = releaseStamp(latest)
  if (currentStamp && latestStamp) return currentStamp === latestStamp
  if (current.prerelease.length !== latest.prerelease.length) return false
  return current.prerelease.every((identifier, index) => {
    const other = latest.prerelease[index]
    if (identifier === other) return true
    // semver compares oversized numeric prerelease identifiers after numeric coercion.
    return /^[0-9]+$/.test(identifier) && /^[0-9]+$/.test(other) && Number(identifier) === Number(other)
  })
}

function invalidComponent(value: string) {
  if (value.length > 1 && value.startsWith("0")) return true
  if (value.length !== maximumComponent.length) return value.length > maximumComponent.length
  return value > maximumComponent
}
