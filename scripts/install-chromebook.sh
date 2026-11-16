#!/usr/bin/env bash
# Compatibility wrapper. The Ruth installer is scripts/install.sh.
set -euo pipefail
exec "$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/install.sh" "$@"
