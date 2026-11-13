#!/usr/bin/env bash
# Reviewable Jarvis Code rebrand. This script is the record of the product rename
# from OpenCode. Run from the repository root. It is idempotent for the mechanical
# bits; hand follow-ups are listed at the bottom and were applied in the same
# chromebook-lite / jarvis-code work.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

echo "Jarvis Code rebrand (scripted, reviewable)"
echo "=========================================="
echo "Product name:  Jarvis Code"
echo "CLI binary:    jcode"
echo "npm publish:   @jarvis-code/cli (internal workspace packages stay @opencode/* so the build and @opencode-ai/plugin imports keep working)"
echo "Config files:  jcode.json, jcode.jsonc (fallback: opencode.json, opencode.jsonc, .opencode/)"
echo "Config dir:    ~/.config/jcode (fallback: ~/.config/opencode and OPENCODE_CONFIG_DIR)"
echo "Data dir:      ~/.local/share/jcode"
echo "Env vars:      JCODE_* with OPENCODE_* fallback (see packages/util/src/env.ts)"
echo

# Sanity: do not rewrite these.
echo "Protected strings (will not be blindly replaced):"
echo "  - MIT license / 'Copyright (c) 2025 opencode'"
echo "  - @opencode-ai/plugin and other plugin/SDK import names"
echo "  - https://github.com/anomalyco/opencode and opencode.ai docs links in attribution"
echo "  - https://models.dev and https://models.opencode.ai"
echo "  - Provider id 'opencode' (the official OpenCode API provider)"
echo "  - Internal workspace package names @opencode/*"
echo

test -f packages/util/src/env.ts || { echo "missing packages/util/src/env.ts"; exit 1; }
grep -q 'const app = "jcode"' packages/util/src/global.ts
grep -q 'jcode.json' packages/core/src/config/discovery.ts
grep -q 'const binary = "jcode"' packages/cli/script/build.ts
grep -q '"jcode"' packages/cli/package.json
test -f packages/cli/bin/jcode.cjs
grep -q 'David Anderson' LICENSE
test -f NOTICE
grep -q 'Jarvis Code' README.md
grep -q 'DEFAULT_TITLE = "Jarvis Code"' packages/tui/src/attention.ts
grep -q "OPENCODE_CLI_NAME:.*jcode" packages/cli/script/build.ts
grep -q 'name: `@jarvis-code/${name}`' packages/cli/script/build.ts
grep -q 'env("CONFIG_DIR")' packages/util/src/global.ts
grep -q 'setTerminalTitle(renderer, "Jarvis Code")' packages/tui/src/app.tsx
grep -q 'Jarvis Code is a private build' packages/cli/src/commands/handlers/upgrade.ts
test -x scripts/install-chromebook.sh
echo "Hand-applied rebrand checkpoints: OK"

echo
echo "Counts of remaining 'opencode' mentions (justification in NOTICE and the build report):"
# Do not scan node_modules, dist, lockfiles, or upstream changelog history.
rg -l --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/bun.lock' --glob '!**/CHANGELOG.md' -i 'opencode' \
  | wc -l | awk '{print "  files:", $1}'
echo "Done."
