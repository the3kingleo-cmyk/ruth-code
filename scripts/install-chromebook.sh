#!/usr/bin/env bash
# Install the Jarvis Code (jcode) linux-x64 binary from the private
# the3kingleo-cmyk/jarvis-code GitHub release. Requires a token that can
# read that repo (GITHUB_TOKEN or GH_TOKEN). Writes only under $HOME.
# Do not run this on a machine the user did not ask to modify.
set -euo pipefail

JCODE_REPO_SLUG="${JCODE_REPO_SLUG:-the3kingleo-cmyk/jarvis-code}"
JCODE_BIN_DIR="${JCODE_BIN_DIR:-$HOME/.local/bin}"
TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"

log() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ -n "$TOKEN" ] || die "GITHUB_TOKEN (or GH_TOKEN) is required to download the private release asset"

api() {
  curl -fsSL -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" "$1"
}

download() {
  curl -fsSL -H "Authorization: Bearer $TOKEN" -H "Accept: application/octet-stream" -o "$2" "$1"
}

command -v jq >/dev/null 2>&1 || die "jq is required to pick the release asset"

json="$(api "https://api.github.com/repos/${JCODE_REPO_SLUG}/releases/latest")"
url="$(printf '%s' "$json" | jq -r '.assets[]? | select(.name|test("linux";"i")) | select(.name|test("x64|amd64|x86_64";"i")) | .url' | head -n 1)"
name="$(printf '%s' "$json" | jq -r '.assets[]? | select(.name|test("linux";"i")) | select(.name|test("x64|amd64|x86_64";"i")) | .name' | head -n 1)"
[ -n "$url" ] && [ "$url" != "null" ] || die "No linux-x64 release asset found on ${JCODE_REPO_SLUG}"

tmpdir="$(mktemp -d /tmp/jcode-install.XXXXXX)"
trap 'rm -rf "$tmpdir"' EXIT
log "Downloading Jarvis Code asset $name ..."
download "$url" "$tmpdir/$name"

case "$name" in
  *.tar.gz|*.tgz) tar -xzf "$tmpdir/$name" -C "$tmpdir" ;;
  *.tar.zst) tar --zstd -xf "$tmpdir/$name" -C "$tmpdir" ;;
  *.zip) unzip -o "$tmpdir/$name" -d "$tmpdir" >/dev/null ;;
  *) cp "$tmpdir/$name" "$tmpdir/jcode" ;;
esac

bin="$(find "$tmpdir" -type f \( -name jcode -o -name opencode \) | head -n 1)"
[ -n "$bin" ] || die "Downloaded asset $name did not contain a jcode binary"

mkdir -p "$JCODE_BIN_DIR"
install -m 0755 "$bin" "$JCODE_BIN_DIR/jcode"
log "Installed $JCODE_BIN_DIR/jcode"

# Env defaults for local Ollama / long SSE idle, appended once.
bashrc="${HOME}/.bashrc"
marker="# jarvis-code chromebook-lite defaults"
if [ -f "$bashrc" ] && ! grep -qF "$marker" "$bashrc"; then
  cat >> "$bashrc" << 'ENV'
# jarvis-code chromebook-lite defaults
export JCODE_SSE_IDLE_TIMEOUT="${JCODE_SSE_IDLE_TIMEOUT:-600000}"
export JCODE_OLLAMA_ASSUME_TOOLS="${JCODE_OLLAMA_ASSUME_TOOLS:-1}"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
ENV
  log "Appended Jarvis Code env defaults to $bashrc"
fi

log "Done. Open a new terminal (or source ~/.bashrc), then run: jcode --version"
