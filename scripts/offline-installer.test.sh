#!/bin/sh
# Tests for scripts/offline-installer.sh. Packed into a tiny ruth.run-like payload.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
INSTALLER="${1:-$ROOT/scripts/offline-installer.sh}"
[ -f "$INSTALLER" ] || { echo "missing $INSTALLER" >&2; exit 1; }
sh -n "$INSTALLER"

WORK=$(mktemp -d /tmp/ruth-installer-test.XXXXXX)
trap 'rm -rf "$WORK"' EXIT INT TERM
PASS=0
FAIL=0

pass() { PASS=$((PASS+1)); printf 'PASS %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf 'FAIL %s\n' "$1"; }

pack_mini() {
  dest=$1
  stage="$WORK/stage"
  rm -rf "$stage"
  mkdir -p "$stage/bin" "$stage/models/blobs"
  printf '#!/bin/sh\nprintf "ruth-stub %%s\\n" "$*"\n' >"$stage/bin/ruth"
  chmod 755 "$stage/bin/ruth"
  if [ -n "${FAKE_OLLAMA:-}" ]; then
    cp -f "$FAKE_OLLAMA" "$stage/bin/ollama"
    chmod 755 "$stage/bin/ollama"
  else
    printf '#!/bin/sh\necho "stub-ollama $*" >&2; exit 1\n' >"$stage/bin/ollama"
    chmod 755 "$stage/bin/ollama"
  fi
  printf 'dummy-gguf\n' >"$stage/models/blobs/sha256-4ecac2ba3fd000cf4638ce65dbffacbd8062c2c87a24a75559af421341adb4b2"
  tar -C "$stage" -cf - bin models | gzip -n >"$WORK/payload.tar.gz"
  { cat "$INSTALLER"; printf '__RUTH_ARCHIVE__\n'; cat "$WORK/payload.tar.gz"; } >"$dest"
  chmod 755 "$dest"
}

write_fake_ollama() {
  cat >"$1" << 'FAKE'
#!/bin/sh
set -eu
logdir="${XDG_STATE_HOME:-$HOME/.local/state}/ruth"
mkdir -p "$logdir"
printf '%s\n' "$*" >>"$logdir/ollama-args.log"
case "${1:-}" in
  serve)
    host="127.0.0.1"
    port="11434"
    if [ -n "${OLLAMA_HOST:-}" ]; then
      host=${OLLAMA_HOST%:*}
      port=${OLLAMA_HOST##*:}
    fi
    python3 - "$host" "$port" "$logdir" << 'PY'
import json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
host, port, logdir = sys.argv[1], int(sys.argv[2]), sys.argv[3]
created = {"models": []}
class H(BaseHTTPRequestHandler):
    def log_message(self, *args):
        return
    def do_GET(self):
        if self.path.startswith("/api/tags"):
            body = json.dumps({"models": created["models"]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        if self.path.startswith("/api/create"):
            created["models"] = [{"name": "ruth:latest", "model": "ruth:latest"}]
            open(os.path.join(logdir, "api-create.json"), "wb").write(raw)
            body = b'{"status":"success"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith("/api/show"):
            body = json.dumps({"renderer": "qwen3.5", "parser": "qwen3.5", "model": "ruth"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()
ThreadingHTTPServer((host, port), H).serve_forever()
PY
    ;;
  create)
    mf=""
    while [ "$#" -gt 0 ]; do
      if [ "$1" = "-f" ]; then
        shift
        mf=$1
      fi
      shift
    done
    if [ -n "$mf" ] && [ -f "$mf" ]; then
      cp -f "$mf" "$logdir/created.Modelfile"
    fi
    printf 'creating ruth\nsuccess\n'
    ;;
  *)
    echo "fake-ollama: unknown $*" >&2
    exit 1
    ;;
esac
FAKE
  chmod 755 "$1"
}

run_low_disk() {
  name="low disk space fails clearly"
  home="$WORK/home-low"
  mkdir -p "$home"
  pack_mini "$WORK/low.run"
  set +e
  out=$(
    env -i HOME="$home" PATH="/usr/bin:/bin" USER=test \
      RUTH_OLLAMA_ORIGIN="http://127.0.0.1:1" \
      RUTH_TAGS_TIMEOUT=2 RUTH_CURL_TIMEOUT=2 \
      RUTH_INSTALL_FREE_KB=1024 \
      RUTH_INSTALL_NO_LAUNCH=1 \
      sh "$WORK/low.run" 2>&1
  )
  st=$?
  set -e
  if [ "$st" -ne 0 ] && printf '%s' "$out" | grep -q "not enough free disk space"; then
    if printf '%s' "$out" | grep -q "Extracting the bundled model"; then
      fail "$name (started extract anyway)"
    else
      pass "$name"
    fi
  else
    printf '%s\n' "$out" >&2
    fail "$name (exit $st)"
  fi
}

run_clean_home() {
  name="clean HOME starts bundled Ollama and imports the model"
  write_fake_ollama "$WORK/fake-ollama"
  FAKE_OLLAMA="$WORK/fake-ollama" pack_mini "$WORK/clean.run"
  set +e
  out=$(
    TEST_HOME="$WORK/home-clean" TEST_RUN="$WORK/clean.run" \
    unshare --net --map-root-user --fork --pid --mount-proc -- /bin/sh -c '
      set -eu
      ip link set lo up 2>/dev/null || ifconfig lo up 2>/dev/null || true
      home=$TEST_HOME
      run=$TEST_RUN
      mkdir -p "$home"
      export HOME="$home"
      unset OLLAMA_HOST OLLAMA_MODELS OLLAMA_ORIGIN RUTH_OLLAMA_ORIGIN
      unset XDG_CONFIG_HOME XDG_DATA_HOME XDG_STATE_HOME XDG_CACHE_HOME
      export XDG_CONFIG_HOME="$HOME/.config"
      export XDG_DATA_HOME="$HOME/.local/share"
      export XDG_STATE_HOME="$HOME/.local/state"
      export XDG_CACHE_HOME="$HOME/.cache"
      export PATH="/usr/bin:/bin"
      export RUTH_INSTALL_NO_LAUNCH=1
      export RUTH_START_TIMEOUT=15
      export RUTH_TAGS_TIMEOUT=5
      export RUTH_CURL_TIMEOUT=3
      export RUTH_CREATE_TIMEOUT=15
      if command -v ollama >/dev/null 2>&1; then
        echo "error: ollama was on PATH: $(command -v ollama)" >&2
        exit 90
      fi
      if python3 -c "import socket,sys; s=socket.socket(); s.settimeout(1); s.connect((\"127.0.0.1\",11434))" 2>/dev/null; then
        echo "error: port 11434 is already in use inside the test netns" >&2
        exit 91
      fi
      sh "$run"
      echo "INSTALL_EXIT:$?"
      [ -x "$HOME/.local/bin/ruth" ] || { echo "error: ruth binary missing"; exit 92; }
      [ -x "$HOME/.local/bin/ollama" ] || { echo "error: bundled ollama was not installed"; exit 93; }
      [ -f "$HOME/.local/state/ruth/ollama.pid" ] || { echo "error: ollama pid file missing"; exit 94; }
      pid=$(cat "$HOME/.local/state/ruth/ollama.pid")
      kill -0 "$pid" 2>/dev/null || { echo "error: bundled ollama is not running"; exit 95; }
      python3 -c "import socket; s=socket.socket(); s.settimeout(2); s.connect((\"127.0.0.1\",11434))" || {
        echo "error: nothing listening on 11434 after install"
        exit 96
      }
      if [ ! -f "$HOME/.local/state/ruth/created.Modelfile" ] || ! grep -q "FROM " "$HOME/.local/state/ruth/created.Modelfile"; then
        echo "error: ollama create was not called with a Modelfile"
        ls -la "$HOME/.local/state/ruth" || true
        exit 97
      fi
      grep -q "OLLAMA_MODELS=" "$HOME/.bashrc" || { echo "error: OLLAMA_MODELS was not added to bashrc"; exit 98; }
      grep -Fqs "export PATH=\"\$HOME/.local/bin:\$PATH\"" "$HOME/.bashrc" || {
        echo "error: PATH was not added to .bashrc"
        cat "$HOME/.bashrc"
        exit 99
      }
      grep -Fqs "export PATH=\"\$HOME/.local/bin:\$PATH\"" "$HOME/.profile" || {
        echo "error: PATH was not added to .profile"
        cat "$HOME/.profile"
        exit 100
      }
      found=$(bash -c ". \"$HOME/.bashrc\"; command -v ruth") || true
      echo "INTERACTIVE_RUTH:$found"
      case "$found" in
        "$HOME/.local/bin/ruth") ;;
        *) echo "error: bashrc PATH did not find ruth (got: $found)"; exit 101 ;;
      esac
      echo CLEAN_OK
    ' 2>&1
  )
  st=$?
  set -e
  skipped=0
  printf '%s' "$out" | grep -q "Skipping bundled model unpack" && skipped=1
  if [ "$st" -eq 0 ] && printf '%s' "$out" | grep -q CLEAN_OK \
     && printf '%s' "$out" | grep -q "Starting the bundled Ollama in your home directory" \
     && printf '%s' "$out" | grep -q "Creating the ruth model" \
     && printf '%s' "$out" | grep -q "Extracting the bundled model" \
     && printf '%s' "$out" | grep -q "Then type: exec bash" \
     && [ "$skipped" -eq 0 ]
  then
    pass "$name"
  else
    printf '%s\n' "$out" >&2
    if [ "$skipped" -eq 1 ]; then
      fail "$name (skipped unpack even though no models existed)"
    else
      fail "$name (exit $st)"
    fi
  fi
}

run_unwritable() {
  name="unwritable system models dir imports via create, no blob copy"
  sysmodels="$WORK/system-models"
  mkdir -p "$sysmodels/blobs"
  chmod 555 "$sysmodels"
  home="$WORK/home-nowrite"
  mkdir -p "$home"
  port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
  python3 - "$port" << 'PY' &
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
port=int(sys.argv[1])
class H(BaseHTTPRequestHandler):
    def log_message(self, *args):
        return
    def do_GET(self):
        body=json.dumps({"models":[{"name":"huihui_ai/qwen3.5-abliterated:2B","model":"huihui_ai/qwen3.5-abliterated:2B"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type","application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_POST(self):
        n=int(self.headers.get("Content-Length") or 0)
        self.rfile.read(n)
        body=b"{}"
        if self.path.startswith("/api/show"):
            body=json.dumps({"renderer":"qwen3.5","parser":"qwen3.5","modelfile":"FROM sha256:4ecac2ba3fd000cf4638ce65dbffacbd8062c2c87a24a75559af421341adb4b2"}).encode()
        elif self.path.startswith("/api/create"):
            body=b'{"status":"success"}'
        self.send_response(200)
        self.send_header("Content-Type","application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
HTTPServer(("127.0.0.1", port), H).serve_forever()
PY
  http_pid=$!
  i=0
  while [ "$i" -lt 20 ]; do
    if curl -sf --max-time 1 "http://127.0.0.1:$port/api/tags" >/dev/null 2>&1; then
      break
    fi
    i=$((i+1))
    sleep 0.1
  done
  write_fake_ollama "$WORK/fake-ollama2"
  FAKE_OLLAMA="$WORK/fake-ollama2" pack_mini "$WORK/nowrite.run"
  set +e
  out=$(
    env -i HOME="$home" PATH="/usr/bin:/bin" USER=test \
      RUTH_OLLAMA_ORIGIN="http://127.0.0.1:$port" \
      OLLAMA_MODELS="$sysmodels" \
      RUTH_INSTALL_NO_LAUNCH=1 \
      RUTH_TAGS_TIMEOUT=5 RUTH_CURL_TIMEOUT=3 RUTH_CREATE_TIMEOUT=15 \
      sh "$WORK/nowrite.run" 2>&1
  )
  st=$?
  set -e
  kill "$http_pid" 2>/dev/null || true
  wait "$http_pid" 2>/dev/null || true
  chmod 755 "$sysmodels" 2>/dev/null || true
  copied=$(find "$sysmodels" -type f 2>/dev/null | wc -l)
  if [ "$st" -eq 0 ] && [ "$copied" -eq 0 ] \
     && printf '%s' "$out" | grep -q "Found existing model" \
     && printf '%s' "$out" | grep -q "Skipping bundled model unpack" \
     && printf '%s' "$out" | grep -q "Creating the ruth model from huihui_ai/qwen3.5-abliterated:2B" \
     && printf '%s' "$out" | grep -q "Then type: exec bash"
  then
    pass "$name"
  else
    printf '%s\n' "$out" >&2
    fail "$name (exit $st, copied=$copied)"
  fi
}

run_low_disk
run_clean_home
run_unwritable

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
