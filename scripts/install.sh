#!/usr/bin/env bash
# Install the Ruth (ruth) linux-x64 binary from the private
# the3kingleo-cmyk/ruth-code GitHub release. Requires a token that can
# read that repo (GITHUB_TOKEN or GH_TOKEN). Writes only under $HOME.
# Do not run this on a machine the user did not ask to modify.
# Never prints the token.
set -euo pipefail

RUTH_REPO_SLUG="${RUTH_REPO_SLUG:-the3kingleo-cmyk/ruth-code}"
OMO_REPO_SLUG="${OMO_REPO_SLUG:-the3kingleo-cmyk/oh-my-openagent}"
OMO_REPO_BRANCH="${OMO_REPO_BRANCH:-chromebook-lite}"
RUTH_BIN_DIR="${RUTH_BIN_DIR:-$HOME/.local/bin}"
OMO_INSTALL_DIR="${OMO_INSTALL_DIR:-$HOME/.local/share/ruth/plugin}"
CONFIG_DIR="${RUTH_CONFIG_DIR:-$HOME/.config/ruth}"
TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
INSTALL_PLUGIN="${INSTALL_PLUGIN:-1}"

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
command -v curl >/dev/null 2>&1 || die "curl is required"

json="$(api "https://api.github.com/repos/${RUTH_REPO_SLUG}/releases/latest")"
url="$(printf '%s' "$json" | jq -r '.assets[]? | select(.name|test("linux";"i")) | select(.name|test("x64|amd64|x86_64";"i")) | .url' | head -n 1)"
name="$(printf '%s' "$json" | jq -r '.assets[]? | select(.name|test("linux";"i")) | select(.name|test("x64|amd64|x86_64";"i")) | .name' | head -n 1)"
[ -n "$url" ] && [ "$url" != "null" ] || die "No linux-x64 release asset found on ${RUTH_REPO_SLUG}"

tmpdir="$(mktemp -d /tmp/ruth-install.XXXXXX)"
trap 'rm -rf "$tmpdir"' EXIT
log "Downloading Ruth asset $name ..."
download "$url" "$tmpdir/$name"

case "$name" in
  *.tar.gz|*.tgz) tar -xzf "$tmpdir/$name" -C "$tmpdir" ;;
  *.tar.zst) tar --zstd -xf "$tmpdir/$name" -C "$tmpdir" ;;
  *.zip) unzip -o "$tmpdir/$name" -d "$tmpdir" >/dev/null ;;
  *) cp "$tmpdir/$name" "$tmpdir/ruth" ;;
esac

bin="$(find "$tmpdir" -type f \( -name ruth -o -name jcode -o -name opencode \) | head -n 1)"
[ -n "$bin" ] || die "Downloaded asset $name did not contain a ruth binary"

mkdir -p "$RUTH_BIN_DIR"
install -m 0755 "$bin" "$RUTH_BIN_DIR/ruth"
log "Installed $RUTH_BIN_DIR/ruth"

# Default config (do not overwrite an existing one).
mkdir -p "$CONFIG_DIR"
if [ ! -f "$CONFIG_DIR/ruth.json" ] && [ ! -f "$CONFIG_DIR/ruth.jsonc" ]; then
  preset=""
  # Prefer a preset next to this script when it was checked out, else a baked-in copy.
  script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  if [ -f "$script_dir/../presets/ruth.json" ]; then
    preset="$script_dir/../presets/ruth.json"
  fi
  if [ -n "$preset" ]; then
    cp "$preset" "$CONFIG_DIR/ruth.json"
  else
    cat > "$CONFIG_DIR/ruth.json" << 'PRESET'
{
  "$comment": "Default Ruth config. Local model is named Ruth (Ollama `ruth` on Qwen3 1.7B, Apache 2.0). Use `ruth-pro` (4B) for heavier tool work.",
  "model": "ollama/ruth",
  "small_model": "ollama/ruth",
  "permissions": [
    { "action": "execute", "resource": "*", "effect": "deny" }
  ],
  "plugins": [],
  "provider": {
    "ollama": {
      "options": {
        "headerTimeout": 1200000,
        "chunkTimeout": false
      },
      "models": {
        "ruth": {
          "capabilities": { "tools": true }
        },
        "ruth-pro": {
          "capabilities": { "tools": true }
        },
        "huihui_ai/qwen3-abliterated:4b": {
          "capabilities": { "tools": true }
        },
        "huihui_ai/qwen3-abliterated:1.7b": {
          "capabilities": { "tools": true }
        }
      }
    }
  }
}
PRESET
  fi
  log "Wrote default $CONFIG_DIR/ruth.json (model: ollama/ruth; tools: ollama/ruth-pro)"
fi


# Persist the token for `ruth upgrade` / `ruth self-update` (mode 600, never echoed).
if [ -n "$TOKEN" ]; then
  mkdir -p "$CONFIG_DIR"
  token_file="$CONFIG_DIR/github-token"
  umask 077
  printf '%s
' "$TOKEN" > "$token_file"
  chmod 600 "$token_file"
  log "Saved a GitHub token to $token_file for future self-updates (not printed)."
fi

# Env defaults and PATH, appended once.
bashrc="${HOME}/.bashrc"
marker="# ruth chromebook-lite defaults"
if [ -f "$bashrc" ] && ! grep -qF "$marker" "$bashrc"; then
  cat >> "$bashrc" << 'ENV'
# ruth chromebook-lite defaults
export RUTH_SSE_IDLE_TIMEOUT="${RUTH_SSE_IDLE_TIMEOUT:-600000}"
export RUTH_OLLAMA_ASSUME_TOOLS="${RUTH_OLLAMA_ASSUME_TOOLS:-1}"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
ENV
  log "Appended Ruth env defaults and PATH to $bashrc"
elif ! grep -qF "$marker" "$bashrc" 2>/dev/null; then
  # no bashrc yet
  mkdir -p "$HOME"
  cat >> "$bashrc" << 'ENV'
# ruth chromebook-lite defaults
export RUTH_SSE_IDLE_TIMEOUT="${RUTH_SSE_IDLE_TIMEOUT:-600000}"
export RUTH_OLLAMA_ASSUME_TOOLS="${RUTH_OLLAMA_ASSUME_TOOLS:-1}"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
ENV
  log "Created $bashrc with Ruth env defaults and PATH"
fi

install_plugin() {
  if ! command -v bun >/dev/null 2>&1; then
    log "bun is not installed; installing to ~/.bun ..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
    command -v bun >/dev/null 2>&1 || die "bun install failed; install bun from https://bun.sh and re-run"
  fi
  mkdir -p "$(dirname "$OMO_INSTALL_DIR")"
  if [ -d "$OMO_INSTALL_DIR/.git" ]; then
    log "Updating $OMO_INSTALL_DIR ..."
    git -C "$OMO_INSTALL_DIR" fetch origin "$OMO_REPO_BRANCH"
    git -C "$OMO_INSTALL_DIR" checkout "$OMO_REPO_BRANCH"
    git -C "$OMO_INSTALL_DIR" pull --ff-only origin "$OMO_REPO_BRANCH" || true
  else
    log "Cloning $OMO_REPO_SLUG ($OMO_REPO_BRANCH) into $OMO_INSTALL_DIR ..."
    git clone --branch "$OMO_REPO_BRANCH" --single-branch "https://x-access-token:${TOKEN}@github.com/${OMO_REPO_SLUG}.git" "$OMO_INSTALL_DIR"
    git -C "$OMO_INSTALL_DIR" remote set-url origin "https://github.com/${OMO_REPO_SLUG}.git"
  fi
  log "Building the Oh My OpenCode chromebook-lite plugin ..."
  (
    cd "$OMO_INSTALL_DIR"
    bun install
    bun run build || bun build packages/omo-opencode/src/index.ts --outdir dist --target bun --format esm --external zod
  )
  [ -f "$OMO_INSTALL_DIR/dist/index.js" ] || log "warning: dist/index.js not found; the plugin may not load until the build succeeds"

  cfg="$CONFIG_DIR/ruth.json"
  [ -f "$cfg" ] || cfg="$CONFIG_DIR/ruth.jsonc"
  if [ -f "$cfg" ]; then
    backup="${cfg}.bak.$(date +%Y%m%d%H%M%S)"
    cp -a "$cfg" "$backup"
    log "Backed up $cfg -> $backup"
    plugin_path="$OMO_INSTALL_DIR"
    tmp="$(mktemp)"
    jq --arg p "$plugin_path" '
      .plugins = ((.plugins // [])
        | map(if type=="string" then . else .package end)
        | map(select(. != $p and . != ($p+"/") ))
        + [$p])
    ' "$cfg" > "$tmp" && mv "$tmp" "$cfg"
    log "Registered plugin $plugin_path in $cfg"
  fi
}

if [ "$INSTALL_PLUGIN" = "1" ] || [ "$INSTALL_PLUGIN" = "true" ] || [ "$INSTALL_PLUGIN" = "yes" ]; then
  command -v jq >/dev/null 2>&1 || die "jq is required to register the plugin in ruth.json"
  install_plugin
else
  log "Skipping Oh My OpenCode plugin (INSTALL_PLUGIN=0). Set INSTALL_PLUGIN=1 to install it."
fi

# Local chat model — first-run talks to the named Ruth Ollama model.
if command -v ollama >/dev/null 2>&1; then
  script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  if [ -x "$script_dir/create-ruth-models.sh" ]; then
    "$script_dir/create-ruth-models.sh" || log "warning: could not build Ruth Ollama models. Later run: ruth doctor --repair"
  else
    log "Building Ruth Ollama models via: ruth doctor --repair"
    if command -v ruth >/dev/null 2>&1; then
      ruth doctor --repair || log "warning: ruth doctor --repair did not finish. Later run: ruth doctor --repair"
    fi
  fi
else
  log "Ollama is not on PATH. Install it from https://ollama.com, then: ruth doctor --repair"
fi

log "Cloud providers (OpenCode Zen and others) are not pre-keyed. After local chat works, you can run: ruth auth login"
log ""
log "Next steps:"
log "  1. source ~/.bashrc    (or open a new terminal so PATH includes ~/.local/bin)"
log "  2. ruth --version"
log "  3. ruth run 'hello'"
log "  4. ruth doctor         (repairs config/PATH/model if needed)"
log "Done."
