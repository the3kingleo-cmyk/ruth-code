import { createHash } from "crypto"
import fs from "fs"
import os from "os"
import path from "path"
import { env } from "@opencode/util/env"
import { DEFAULT_REPO_SLUG } from "./defaults"

export type ReleaseAsset = {
  name: string
  url: string
  digest?: string
}

export type GithubRelease = {
  tag: string
  name: string
  assets: ReleaseAsset[]
}

export function resolveGithubToken(): string | undefined {
  const fromEnv =
    env("GITHUB_TOKEN") || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || env("GH_TOKEN")
  if (fromEnv) return fromEnv
  const file = path.join(env("CONFIG_DIR") || path.join(os.homedir(), ".config", "ruth"), "github-token")
  try {
    const text = fs.readFileSync(file, "utf8").trim()
    return text || undefined
  } catch {
    return undefined
  }
}

export function repoSlug(): string {
  return env("REPO_SLUG") || process.env.RUTH_REPO_SLUG || DEFAULT_REPO_SLUG
}

function headers(token?: string, accept = "application/vnd.github+json"): Record<string, string> {
  const value: Record<string, string> = { Accept: accept, "User-Agent": "ruth-cli" }
  if (token) value.Authorization = `Bearer ${token}`
  return value
}

export async function fetchLatestRelease(
  options: { token?: string; slug?: string; fetchImpl?: typeof fetch } = {},
): Promise<GithubRelease> {
  const token = options.token ?? resolveGithubToken()
  const slug = options.slug ?? repoSlug()
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(`https://api.github.com/repos/${slug}/releases/latest`, {
    headers: headers(token),
  })
  if (!response.ok) {
    throw new Error(`Could not read ${slug} releases (${response.status}). A GitHub token is required for the private repo.`)
  }
  const json = (await response.json()) as {
    tag_name?: string
    name?: string
    assets?: Array<{ name: string; url: string; digest?: string }>
  }
  return {
    tag: json.tag_name ?? "unknown",
    name: json.name ?? json.tag_name ?? "unknown",
    assets: (json.assets ?? []).map((asset) => ({
      name: asset.name,
      url: asset.url,
      digest: asset.digest,
    })),
  }
}

export function pickLinuxX64Asset(release: GithubRelease): { binary?: ReleaseAsset; checksum?: ReleaseAsset } {
  const assets = release.assets
  const binary = assets.find(
    (asset) => /linux/i.test(asset.name) && /x64|amd64|x86_64/i.test(asset.name) && !/\.sha256$/i.test(asset.name),
  )
  const checksum =
    (binary && assets.find((asset) => asset.name === `${binary.name}.sha256`)) ||
    assets.find((asset) => /\.sha256$/i.test(asset.name))
  return { binary, checksum }
}

export function parseSha256(text: string): string | undefined {
  const match = text.trim().match(/\b([a-fA-F0-9]{64})\b/)
  return match?.[1]?.toLowerCase()
}

export function sha256File(file: string): string {
  const hash = createHash("sha256")
  hash.update(fs.readFileSync(file))
  return hash.digest("hex")
}

export async function downloadAsset(
  asset: ReleaseAsset,
  dest: string,
  options: { token?: string; fetchImpl?: typeof fetch } = {},
): Promise<void> {
  const token = options.token ?? resolveGithubToken()
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(asset.url, {
    headers: headers(token, "application/octet-stream"),
    redirect: "follow",
  })
  if (!response.ok) throw new Error(`Failed to download ${asset.name} (${response.status})`)
  const bytes = Buffer.from(await response.arrayBuffer())
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, bytes)
}

export async function resolveExpectedSha256(
  release: { binary?: ReleaseAsset; checksum?: ReleaseAsset },
  options: { token?: string; fetchImpl?: typeof fetch } = {},
): Promise<string | undefined> {
  if (release.binary?.digest) {
    const fromDigest = parseSha256(release.binary.digest)
    if (fromDigest) return fromDigest
  }
  if (!release.checksum) return undefined
  const token = options.token ?? resolveGithubToken()
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(release.checksum.url, {
    headers: headers(token, "application/octet-stream"),
    redirect: "follow",
  })
  if (!response.ok) return undefined
  return parseSha256(await response.text())
}
