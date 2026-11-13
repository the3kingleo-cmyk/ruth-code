import { spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import {
  downloadAsset,
  fetchLatestRelease,
  pickLinuxX64Asset,
  resolveExpectedSha256,
  resolveGithubToken,
  sha256File,
} from "./github-release"


export function runningBinary(): string {
  const exec = process.execPath
  const base = path.basename(exec).replace(/\.exe$/i, "")
  if (base === "ruth" || base === "jcode" || base === "opencode") return exec
  const argv1 = process.argv[1]
  if (argv1 && fs.existsSync(argv1) && /(?:^|\/)(ruth|jcode|opencode)$/.test(argv1.replace(/\.exe$/i, ""))) return argv1
  return exec
}

export type SelfUpdateResult = {
  ok: boolean
  action: "updated" | "already-latest" | "rolled-back" | "failed"
  from?: string
  to?: string
  binary?: string
  previous?: string
  detail: string
}

export type SelfUpdateOptions = {
  currentVersion?: string
  currentBinary?: string
  token?: string
  target?: string
  chatCheck?: boolean
  fetchImpl?: typeof fetch
  run?: typeof spawnSync
  extract?: (archive: string, directory: string) => string
}

function defaultExtract(archive: string, directory: string): string {
  fs.mkdirSync(directory, { recursive: true })
  if (archive.endsWith(".tar.gz") || archive.endsWith(".tgz")) {
    const result = spawnSync("tar", ["-xzf", archive, "-C", directory], { encoding: "utf8" })
    if (result.status !== 0) throw new Error(result.stderr || "tar extract failed")
  } else if (archive.endsWith(".zip")) {
    const result = spawnSync("unzip", ["-o", archive, "-d", directory], { encoding: "utf8" })
    if (result.status !== 0) throw new Error(result.stderr || "unzip failed")
  } else {
    const dest = path.join(directory, "ruth")
    fs.copyFileSync(archive, dest)
    fs.chmodSync(dest, 0o755)
    return dest
  }
  const found = walkForBinary(directory)
  if (!found) throw new Error("The release archive did not contain a ruth binary")
  fs.chmodSync(found, 0o755)
  return found
}

function walkForBinary(directory: string): string | undefined {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = walkForBinary(full)
      if (nested) return nested
    } else if (entry.name === "ruth" || entry.name === "jcode" || entry.name === "opencode") {
      return full
    }
  }
  return undefined
}

export function healthCheck(
  binary: string,
  options: { chatCheck?: boolean; run?: typeof spawnSync } = {},
): { ok: boolean; detail: string } {
  const run = options.run ?? spawnSync
  const version = run(binary, ["--version"], { encoding: "utf8", timeout: 20_000 })
  if (version.status !== 0) {
    return { ok: false, detail: `health-check --version failed: ${(version.stderr || version.stdout || "").trim()}` }
  }
  if (options.chatCheck === false) {
    return { ok: true, detail: (version.stdout || "").trim() }
  }
  const ollama = run("ollama", ["list"], { encoding: "utf8", timeout: 10_000 })
  if (ollama.status !== 0) {
    return { ok: true, detail: `${(version.stdout || "").trim()} (chat check skipped: ollama not available)` }
  }
  const chat = run(binary, ["run", "--format", "json", "Say hi in three words."], {
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, CI: "1" },
  })
  if (chat.status !== 0) {
    return {
      ok: false,
      detail: `health-check chat failed: ${(chat.stderr || chat.stdout || "exit " + String(chat.status)).trim()}`,
    }
  }
  return { ok: true, detail: (version.stdout || "").trim() }
}

function replaceBinary(current: string, next: string): { previous: string } {
  const previous = `${current}.prev`
  if (fs.existsSync(previous)) fs.rmSync(previous)
  fs.copyFileSync(current, previous)
  fs.chmodSync(previous, 0o755)
  const staged = `${current}.new`
  fs.copyFileSync(next, staged)
  fs.chmodSync(staged, 0o755)
  fs.renameSync(staged, current)
  return { previous }
}

export function rollbackBinary(current: string, previous: string): void {
  if (!fs.existsSync(previous)) throw new Error(`No previous binary at ${previous}`)
  const failed = `${current}.failed`
  if (fs.existsSync(failed)) fs.rmSync(failed)
  if (fs.existsSync(current)) fs.renameSync(current, failed)
  fs.copyFileSync(previous, current)
  fs.chmodSync(current, 0o755)
}

export async function selfUpdate(options: SelfUpdateOptions = {}): Promise<SelfUpdateResult> {
  const token = options.token ?? resolveGithubToken()
  const currentBinary = options.currentBinary ?? runningBinary()
  const currentVersion = (options.currentVersion ?? "").replace(/^v/, "")
  const extract = options.extract ?? defaultExtract

  try {
    const release = await fetchLatestRelease({ token, fetchImpl: options.fetchImpl })
    const tag = release.tag.replace(/^v/, "")
    if (options.target) {
      // Caller can pass a tag; latest is used when target is omitted or matches latest.
      const wanted = options.target.replace(/^v/, "")
      if (wanted !== tag) {
        return {
          ok: false,
          action: "failed",
          detail: `Requested ${options.target}, but this updater currently installs the latest release (${release.tag}).`,
        }
      }
    }
    if (currentVersion && (tag === currentVersion || release.tag === currentVersion || `v${currentVersion}` === release.tag)) {
      return { ok: true, action: "already-latest", from: currentVersion, to: release.tag, detail: `Already on ${release.tag}` }
    }

    const picked = pickLinuxX64Asset(release)
    if (!picked.binary) {
      return { ok: false, action: "failed", detail: `No linux-x64 asset on ${release.tag}` }
    }
    const expected = await resolveExpectedSha256(picked, { token, fetchImpl: options.fetchImpl })
    if (!expected) {
      return { ok: false, action: "failed", detail: "Release is missing a sha256 digest; refusing to install it." }
    }

    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ruth-update-"))
    const archive = path.join(temp, picked.binary.name)
    await downloadAsset(picked.binary, archive, { token, fetchImpl: options.fetchImpl })
    const actual = sha256File(archive)
    if (actual !== expected) {
      return {
        ok: false,
        action: "failed",
        detail: `sha256 mismatch for ${picked.binary.name}: expected ${expected}, got ${actual}`,
      }
    }
    const extracted = extract(archive, path.join(temp, "bin"))
    const check = healthCheck(extracted, { chatCheck: options.chatCheck, run: options.run })
    if (!check.ok) {
      return { ok: false, action: "failed", detail: `Downloaded binary failed health-check: ${check.detail}` }
    }

    const { previous } = replaceBinary(currentBinary, extracted)
    const installed = healthCheck(currentBinary, { chatCheck: options.chatCheck, run: options.run })
    if (!installed.ok) {
      rollbackBinary(currentBinary, previous)
      return {
        ok: false,
        action: "rolled-back",
        from: currentVersion,
        to: release.tag,
        previous,
        binary: currentBinary,
        detail: `Installed ${release.tag} failed health-check and was rolled back: ${installed.detail}`,
      }
    }
    return {
      ok: true,
      action: "updated",
      from: currentVersion,
      to: release.tag,
      binary: currentBinary,
      previous,
      detail: `Updated ${currentVersion || "this build"} → ${release.tag}. Previous binary kept at ${previous}.`,
    }
  } catch (error) {
    return { ok: false, action: "failed", detail: error instanceof Error ? error.message : String(error) }
  }
}
