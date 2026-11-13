#!/usr/bin/env bash
# Reviewable Ruth rebrand. This script is the record of the product rename
# from OpenCode / Jarvis Code. Run from the repository root. It is idempotent
# for the mechanical checkpoints; hand follow-ups were applied in this tree.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

echo "Ruth rebrand (scripted, reviewable)"
echo "==================================="
echo "Product name:  Ruth"
echo "CLI binary:    ruth"
echo "npm publish:   @ruth/cli (internal workspace packages stay @opencode/* so the build and @opencode-ai/plugin imports keep working)"
echo "Config files:  ruth.json, ruth.jsonc (fallback: jcode.json, opencode.json, .ruth/, .opencode/)"
echo "Config dir:    ~/.config/ruth"
echo "Data dir:      ~/.local/share/ruth"
echo "Env vars:      RUTH_* with JCODE_* and OPENCODE_* fallbacks (see packages/util/src/env.ts)"
echo

echo "Protected strings (will not be blindly replaced):"
echo "  - MIT license / 'Copyright (c) 2025 opencode'"
echo "  - @opencode-ai/plugin and other plugin/SDK import names"
echo "  - https://github.com/anomalyco/opencode and opencode.ai docs links in attribution"
echo "  - https://models.dev and https://models.opencode.ai"
echo "  - Provider id 'opencode' (OpenCode Zen / official OpenCode API provider)"
echo "  - Internal workspace package names @opencode/*"
echo "  - The existing public the3kingleo-cmyk/ruth project (this tree is ruth-code)"
echo

test -f packages/util/src/env.ts || { echo "missing packages/util/src/env.ts"; exit 1; }
grep -q 'const app = "ruth"' packages/util/src/global.ts
grep -q 'ruth.json' packages/core/src/config/discovery.ts
grep -q 'const binary = "ruth"' packages/cli/script/build.ts
grep -q '"ruth"' packages/cli/package.json
test -f packages/cli/bin/ruth.cjs
grep -q 'David Anderson' LICENSE
test -f NOTICE
grep -q '^# Ruth' README.md
grep -q 'DEFAULT_TITLE = "Ruth"' packages/tui/src/attention.ts
grep -q "OPENCODE_CLI_NAME:.*ruth" packages/cli/script/build.ts
grep -q 'name: `@ruth/${name}`' packages/cli/script/build.ts
grep -q 'env("CONFIG_DIR")' packages/util/src/global.ts
grep -q 'setTerminalTitle(renderer, "Ruth")' packages/tui/src/app.tsx
grep -q 'Ruth is a private build' packages/cli/src/commands/handlers/upgrade.ts
grep -q 'PREFERS RUTH' packages/util/src/env.ts || grep -q 'Canonical prefix is `RUTH_`' packages/util/src/env.ts
test -x scripts/install.sh
test -f presets/ruth.json
echo "Hand-applied rebrand checkpoints: OK"

echo
echo "Counts of remaining 'opencode' mentions (justification in NOTICE and the build report):"
rg -l --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/bun.lock' --glob '!**/CHANGELOG.md' -i 'opencode' \
  | wc -l | awk '{print "  files:", $1}'
echo "Done."
