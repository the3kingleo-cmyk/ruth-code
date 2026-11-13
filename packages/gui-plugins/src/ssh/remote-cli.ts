export * as RemoteCli from "./remote-cli"

import { Effect, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"

export class Failure extends Schema.TaggedError<Failure>()("RemoteCliFailure", {
  code: Schema.Literals(["platform", "version", "install"]),
  detail: Schema.String,
}) {
  override get message() {
    return this.detail
  }
}

export function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function requireVersion(version: string) {
  if (version !== "local" && !/^[0-9][a-zA-Z0-9.+-]*$/.test(version))
    throw new Failure({ code: "version", detail: version })

  return version
}

export function discoverScript(options: { fromPath?: boolean; cache?: { directory: string; prefix: string } } = {}) {
  return `cli=${options.fromPath ? "$(command -v ruth || command -v opencode || true)" : '""'}
if [ -z "$cli" ] && [ -x "$HOME/.local/bin/ruth" ]; then cli="$HOME/.local/bin/ruth"; fi
${
  options.cache
    ? `if [ -z "$cli" ]; then
  for binary in "$HOME"/${quote(options.cache.directory)}/${quote(options.cache.prefix)}*/ruth "$HOME"/${quote(options.cache.directory)}/${quote(options.cache.prefix)}*/opencode; do
    if [ -x "$binary" ]; then cli="$binary"; fi
  done
fi
`
    : ""
}if [ -n "$cli" ]; then printf '%s\\n' "$cli"; fi
`
}

// Adapters supply a quoted shell expression, including remote HOME or wslpath expansion.
export function versionScript(command: string) {
  return `if [ -x ${command} ]; then ${command} --version 2>/dev/null || true; fi\n`
}

export function parseVersion(output: string) {
  const line = output
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim()

  if (!line) return null
  const marker = line.lastIndexOf(" v")
  const version = marker === -1 ? line : line.slice(marker + 2)

  if (!version) throw new Error("V2 CLI did not provide a version")

  return version
}

export const probeScript = `set -eu
os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$os" in linux|darwin) ;; *) exit 2 ;; esac
case "$arch" in x86_64|amd64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) exit 2 ;; esac
target="$os-$arch"
if [ "$arch" = x64 ]; then target="$target-baseline"; fi
if [ "$os" = linux ]; then
  if [ -f /etc/alpine-release ] || (ldd --version 2>&1 | grep -qi musl); then target="$target-musl"; fi
fi
printf 'OPENCODE_REMOTE_TARGET=%s\\n' "$target"
`

const RELEASE_ASSETS: Record<string, string> = {
  "linux-x64-baseline": "ruth-linux-x64.tar.gz",
  "linux-x64-baseline-musl": "ruth-linux-x64.tar.gz",
  "linux-arm64": "ruth-linux-arm64.tar.gz",
  "linux-arm64-musl": "ruth-linux-arm64.tar.gz",
  "darwin-x64-baseline": "ruth-darwin-x64.tar.gz",
  "darwin-x64-baseline-musl": "ruth-darwin-x64.tar.gz",
  "darwin-arm64": "ruth-darwin-arm64.tar.gz",
  "darwin-arm64-musl": "ruth-darwin-arm64.tar.gz",
}

export function archiveUrl(target: string, version: string) {
  const asset = RELEASE_ASSETS[target]
  if (!asset) throw new Failure({ code: "platform", detail: target })

  return `https://github.com/the3kingleo-cmyk/ruth-install/releases/download/v${requireVersion(version)}/${asset}`
}

type Source = { type: "download"; url: string } | { type: "archive" } | { type: "installer"; binary?: string }

export function installScript(input: { version: string; directory?: string; source: Source }) {
  const version = requireVersion(input.version)

  // The managed CLI installer also configures the user's shell PATH. Private
  // installations use archives so their destination and shell setup stay isolated.
  if (input.source.type === "installer")
    return `set -eu
curl -fsSL https://the3kingleo-cmyk.github.io/ruth-install | bash -s -- ${input.source.binary ? `--binary ${input.source.binary}` : `--version ${quote(version)}`}
${verifyScript('"$HOME/.local/bin/ruth"', version)}
`

  return `set -eu
umask 077
destination="$HOME"/${quote(`${input.directory ?? ".local/bin"}/ruth`)}
mkdir -p "$(dirname "$destination")"
stage=$(mktemp -d "$(dirname "$destination")/.install-XXXXXX")
trap 'rm -rf "$stage"' EXIT
${stageBinary(input.source)}
binary=""
if [ -f "$stage/bin/ruth" ]; then binary="$stage/bin/ruth"
elif [ -f "$stage/package/bin/ruth" ]; then binary="$stage/package/bin/ruth"
else binary=$(find "$stage" -type f \\( -name ruth -o -name opencode \\) | head -n 1)
fi
if [ -z "$binary" ]; then echo "The release archive did not contain a ruth binary" >&2; exit 1; fi
chmod 755 "$binary"
${verifyScript('"$binary"', version)}
mv "$binary" "$destination"
`
}

function stageBinary(source: Exclude<Source, { type: "installer" }>) {
  if (source.type === "archive") return 'cat > "$stage/archive.tgz"\ntar -xzf "$stage/archive.tgz" -C "$stage"'

  return `url=${quote(source.url)}
if command -v curl >/dev/null 2>&1; then
  curl -fsSL --connect-timeout 15 --max-time 180 "$url" -o "$stage/archive.tgz"
else
  wget -T 180 -O "$stage/archive.tgz" "$url"
fi
tar -xzf "$stage/archive.tgz" -C "$stage"`
}

function verifyScript(command: string, version: string) {
  return `test "$(${command} --version | awk '{print $NF}' | sed 's/^v//')" = ${quote(version)}`
}

const LatestRelease = Schema.Struct({ tag_name: Schema.String })

export const latestBeta = Effect.fn("RemoteCli.latestBeta")(function* () {
  const http = yield* HttpClient.HttpClient
  const url = "https://api.github.com/repos/the3kingleo-cmyk/ruth-install/releases/latest"

  const metadata = yield* http.get(url).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(LatestRelease)),
    Effect.timeout("30 seconds"),
    Effect.mapError(() => new Failure({ code: "install", detail: url })),
  )

  const tag = metadata.tag_name.replace(/^v/i, "")
  if (tag !== "local" && !/^[0-9][a-zA-Z0-9.+-]*$/.test(tag))
    return yield* Effect.fail(new Failure({ code: "install", detail: metadata.tag_name }))

  return tag
})
