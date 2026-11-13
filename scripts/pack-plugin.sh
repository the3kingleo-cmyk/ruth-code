#!/bin/sh
# Pack the Chromebook-lite plugin, including a real (dereferenced) node_modules/zod
# so the TUI can load dist/index.js without a "Cannot find package 'zod'" error.
set -eu
SRC="${PLUGIN_SRC:-/workspace/builds/oh-my-openagent}"
OUT="${PLUGIN_OUT:-/tmp/ruth-install-assets/oh-my-openagent-chromebook-lite.tar.gz}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
DEST="$STAGE/oh-my-openagent"
mkdir -p "$DEST/node_modules"
cp -a "$SRC/package.json" "$DEST/"
[ -f "$SRC/LICENSE.md" ] && cp -a "$SRC/LICENSE.md" "$DEST/"
[ -f "$SRC/NOTICE.md" ] && cp -a "$SRC/NOTICE.md" "$DEST/"
cp -a "$SRC/dist" "$DEST/"
[ -e "$SRC/node_modules/zod" ] || { echo "error: $SRC/node_modules/zod is missing" >&2; exit 1; }
cp -aL "$SRC/node_modules/zod" "$DEST/node_modules/zod"
[ -f "$DEST/node_modules/zod/package.json" ] || { echo "error: copied zod is missing package.json" >&2; exit 1; }
mkdir -p "$(dirname "$OUT")"
tar -C "$STAGE" -czf "$OUT" oh-my-openagent
sha256sum "$OUT" > "${OUT}.sha256"
echo "Wrote $OUT"
