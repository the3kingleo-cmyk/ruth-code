#!/bin/sh
# Ruth offline installer. No network. No remote accounts.
# This script is prefixed to a gzip+tar payload after the __RUTH_ARCHIVE__ marker.
set -eu

GGUF_DIGEST="sha256:4ecac2ba3fd000cf4638ce65dbffacbd8062c2c87a24a75559af421341adb4b2"
GGUF_BLOB="sha256-4ecac2ba3fd000cf4638ce65dbffacbd8062c2c87a24a75559af421341adb4b2"
# Conservative 1024-byte KB estimates (includes slack).
PROGRAM_KB=400000
MODEL_KB=2300000
TAGS_TIMEOUT="${RUTH_TAGS_TIMEOUT:-15}"
CREATE_TIMEOUT="${RUTH_CREATE_TIMEOUT:-180}"
IMPORT_TIMEOUT="${RUTH_IMPORT_TIMEOUT:-600}"
CURL_TIMEOUT="${RUTH_CURL_TIMEOUT:-10}"
START_TIMEOUT="${RUTH_START_TIMEOUT:-60}"
STARTED_BUNDLED_OLLAMA=0

log() { printf '%s\n' "$*"; }
step() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

SCRIPT=$0
case "$SCRIPT" in
  /*) ;;
  *) SCRIPT=$(CDPATH= cd -- "$(dirname -- "$SCRIPT")" && pwd)/$(basename -- "$SCRIPT") ;;
esac

MARKER=__RUTH_ARCHIVE__
SKIP=$(awk "BEGIN {m=0} \$0==\"$MARKER\" {print NR+1; m=1; exit} END {if (!m) exit 1}" "$SCRIPT")
[ -n "${SKIP:-}" ] || die "missing archive in installer"

TMP=$(mktemp -d "${TMPDIR:-/tmp}/ruth-offline.XXXXXX")
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

log "Installing Ruth (offline)..."

# --- helpers ---

run_timeout() {
  secs=$1
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout -k 5 "$secs" "$@"
    return $?
  fi
  "$@" &
  _rt_pid=$!
  (
    sleep "$secs"
    kill "$_rt_pid" 2>/dev/null || true
    sleep 2
    kill -9 "$_rt_pid" 2>/dev/null || true
  ) &
  _rt_watch=$!
  if wait "$_rt_pid"; then
    kill "$_rt_watch" 2>/dev/null || true
    wait "$_rt_watch" 2>/dev/null || true
    return 0
  fi
  _rt_st=$?
  kill "$_rt_watch" 2>/dev/null || true
  wait "$_rt_watch" 2>/dev/null || true
  return "$_rt_st"
}

timeout_msg() {
  die "Ollama did not respond within $1s at $OLLAMA_URL. If a server is already running, check that it is healthy. This installer will not start a second server on a port that is already in use."
}

kb_fmt() {
  # print KB as a short human string
  python3 -c 'import sys
kb=int(sys.argv[1] or 0)
if kb>=1048576: print("%.1f GB" % (kb/1048576.0))
elif kb>=1024: print("%d MB" % (kb/1024))
else: print("%d KB" % kb)
' "$1" 2>/dev/null || printf '%s KB' "$1"
}

available_kb() {
  if [ -n "${RUTH_INSTALL_FREE_KB:-}" ]; then
    printf '%s\n' "$RUTH_INSTALL_FREE_KB"
    return 0
  fi
  p=$1
  while [ ! -e "$p" ]; do
    n=$(dirname "$p")
    [ "$n" = "$p" ] && break
    p=$n
  done
  [ -e "$p" ] || p=/
  df -Pk "$p" 2>/dev/null | awk 'NR==2 {print $4; found=1} END {if (!found) exit 1}'
}

require_space() {
  path=$1
  need=$2
  have=$(available_kb "$path") || die "could not check free disk space at $path"
  case "$have" in
    ''|*[!0-9]*) die "could not check free disk space at $path" ;;
  esac
  if [ "$have" -lt "$need" ]; then
    printf 'error: not enough free disk space at %s: %s free, need about %s.\n' \
      "$path" "$(kb_fmt "$have")" "$(kb_fmt "$need")" >&2
    printf 'error: Free some space and run this installer again.\n' >&2
    if [ "${NEED_MODEL_EXTRACT:-0}" = 1 ] && [ "${OLLAMA_REACHABLE:-0}" != 1 ]; then
      printf 'error: Ollama was not reachable, so the bundled model would have to be unpacked. If you already have huihui_ai/qwen3.5-abliterated:2b, start Ollama and rerun this installer to skip that unpack.\n' >&2
    fi
    exit 1
  fi
  log "    $(kb_fmt "$have") free at $path (need about $(kb_fmt "$need"))"
}

writable_dir() {
  # true if we can create/write files in $1 (creating it is allowed when the parent is writable)
  d=$1
  if [ -d "$d" ]; then
    [ -w "$d" ]
    return $?
  fi
  p=$(dirname "$d")
  while [ ! -d "$p" ]; do
    n=$(dirname "$p")
    [ "$n" = "$p" ] && break
    p=$n
  done
  [ -d "$p" ] && [ -w "$p" ]
}

same_device() {
  python3 -c 'import os,sys
a,b=sys.argv[1],sys.argv[2]
def dev(p):
  while p and not os.path.exists(p):
    n=os.path.dirname(p)
    if n==p: break
    p=n
  return os.stat(p if os.path.exists(p) else "/").st_dev
sys.exit(0 if dev(a)==dev(b) else 1)
' "$1" "$2" 2>/dev/null
}

find_blob() {
  for d in "$@"; do
    [ -n "$d" ] || continue
    if [ -f "$d/blobs/$GGUF_BLOB" ]; then
      printf '%s\n' "$d/blobs/$GGUF_BLOB"
      return 0
    fi
  done
  return 1
}

detect_running_models_dir() {
  if [ -d /proc ]; then
    for pid in $(ps -eo pid,args 2>/dev/null | awk '/[o]llama serve/ { print $1 }'); do
      envf="/proc/$pid/environ"
      [ -r "$envf" ] || continue
      models=$(tr '\0' '\n' < "$envf" | sed -n 's/^OLLAMA_MODELS=//p' | head -n 1)
      if [ -n "$models" ]; then
        printf '%s\n' "$models"
        return 0
      fi
      home=$(tr '\0' '\n' < "$envf" | sed -n 's/^HOME=//p' | head -n 1)
      if [ -n "$home" ] && [ -d "$home/.ollama/models" ]; then
        printf '%s\n' "$home/.ollama/models"
        return 0
      fi
    done
  fi
  if [ -d /usr/share/ollama/.ollama/models ]; then
    printf '%s\n' /usr/share/ollama/.ollama/models
    return 0
  fi
  return 1
}

# Extract selected members (or the whole archive) from the trailing gzip+tar payload.
# When only "bin" is requested and it is first in the archive, the 1.8 GB model data is not read.
extract_payload() {
  label=$1
  shift
  step "$label"
  log "    This can take a few minutes on a slow disk. Progress is printed as it goes."
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$SCRIPT" "$SKIP" "$TMP" "$@" << 'PY'
import gzip, os, sys, tarfile, time

script, skip, dest = sys.argv[1], int(sys.argv[2]), sys.argv[3]
members = sys.argv[4:]

class Progress:
    def __init__(self, fp):
        self.fp = fp
        self.n = 0
        self.last = 0
        self.t0 = time.time()
    def read(self, size=-1):
        data = self.fp.read(65536 if size is None or size < 0 else size)
        self.n += len(data)
        if self.n - self.last >= 50 * 1024 * 1024 or not data and self.n and self.last == 0:
            mb = self.n / 1048576.0
            dt = max(time.time() - self.t0, 0.001)
            print(f"    read {mb:.0f} MB ({mb/dt:.1f} MB/s)", flush=True)
            self.last = self.n
        return data

def wanted(name):
    name = name.lstrip("./")
    if not members:
        return True
    for prefix in members:
        prefix = prefix.lstrip("./").rstrip("/")
        if name == prefix or name.startswith(prefix + "/"):
            return True
    return False

with open(script, "rb") as fp:
    for _ in range(skip - 1):
        line = fp.readline()
        if not line:
            sys.stderr.write("error: installer payload is truncated\n")
            sys.exit(1)
    raw = Progress(fp)
    try:
        gz = gzip.GzipFile(fileobj=raw)
        with tarfile.open(fileobj=gz, mode="r|") as tar:
            seen = False
            for info in tar:
                if wanted(info.name):
                    try:
                        tar.extract(info, dest, set_attrs=True, filter="fully_trusted")
                    except TypeError:
                        try:
                            tar.extract(info, dest, set_attrs=True)
                        except TypeError:
                            tar.extract(info, dest)
                    seen = True
                else:
                    # Archive order is bin, lib, models. Stop before reading the 2 GB GGUF.
                    name = info.name.lstrip("./")
                    if seen and (name == "models" or name.startswith("models/")):
                        break
                    src = tar.extractfile(info)
                    if src is not None:
                        while src.read(1024 * 1024):
                            pass
    except Exception as error:
        sys.stderr.write(f"error: failed to extract the installer payload: {error}\n")
        sys.exit(1)
    if raw.last != raw.n and raw.n:
        mb = raw.n / 1048576.0
        dt = max(time.time() - raw.t0, 0.001)
        print(f"    read {mb:.0f} MB ({mb/dt:.1f} MB/s)", flush=True)
PY
  else
    # Fallback: no byte progress, but still a heartbeat so the install is never silent.
    (
      tail -n +"$SKIP" "$SCRIPT" | gzip -dc | tar --no-same-owner -xf - -C "$TMP" "$@"
    ) &
    _ex_pid=$!
    _ex_t=0
    while kill -0 "$_ex_pid" 2>/dev/null; do
      sleep 5
      _ex_t=$((_ex_t + 5))
      if kill -0 "$_ex_pid" 2>/dev/null; then
        log "    ... still extracting (${_ex_t}s)"
      fi
    done
    wait "$_ex_pid" || die "failed to extract the installer payload"
  fi
}

http_ok() {
  url=$1
  secs=${2:-$CURL_TIMEOUT}
  if command -v curl >/dev/null 2>&1; then
    run_timeout "$secs" curl -sf --max-time "$secs" "$url" >/dev/null 2>&1
    return $?
  fi
  python3 - "$url" "$secs" << 'PY'
import sys, urllib.request
url, secs = sys.argv[1], float(sys.argv[2])
try:
    urllib.request.urlopen(url, timeout=secs).read()
except Exception:
    sys.exit(1)
PY
}


port_in_use() {
  python3 -c 'import socket,sys
host,port=sys.argv[1],int(sys.argv[2])
s=socket.socket(); s.settimeout(1)
try:
    s.connect((host, port)); s.close()
except Exception:
    sys.exit(1)
' "$1" "$2" 2>/dev/null
}

ollama_listen_host() {
  # Default: loopback only. Parsed from OLLAMA_URL when possible.
  printf '%s\n' "127.0.0.1"
}

ollama_listen_port() {
  python3 -c 'from urllib.parse import urlparse
import sys
u=urlparse(sys.argv[1])
print(u.port or 11434)
' "$OLLAMA_URL" 2>/dev/null || printf '11434\n'
}

find_ollama_bin() {
  if [ -x "${BIN_DIR:-}/ollama" ]; then
    printf '%s\n' "$BIN_DIR/ollama"
    return 0
  fi
  command -v ollama 2>/dev/null || true
}

start_bundled_ollama() {
  if [ "${OLLAMA_REACHABLE:-0}" = 1 ]; then
    log "    Using the Ollama server already running at $OLLAMA_URL"
    return 0
  fi
  bin=$(find_ollama_bin)
  if [ -z "$bin" ]; then
    die "Ollama is not installed and the bundle did not include an ollama binary."
  fi
  host=$(ollama_listen_host)
  port=$(ollama_listen_port)
  if port_in_use "$host" "$port"; then
    die "Port $port is already in use but is not a responding Ollama API at $OLLAMA_URL. Stop that process and rerun. This installer will not start a second server on that port."
  fi

  # Always serve from a user-writable models dir. Never use sudo or systemd.
  if ! writable_dir "$MODELS_DIR"; then
    log "    $MODELS_DIR is not writable; using $HOME/.ollama/models instead"
    MODELS_DIR="$HOME/.ollama/models"
  fi
  STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/ruth"
  mkdir -p "$MODELS_DIR" "$STATE_DIR"
  OLLAMA_MODELS="$MODELS_DIR"
  OLLAMA_HOST="${host}:${port}"
  export OLLAMA_MODELS OLLAMA_HOST
  step "Starting the bundled Ollama in your home directory (timeout ${START_TIMEOUT}s)"
  log "    Serving at $OLLAMA_URL, models at $OLLAMA_MODELS (no sudo, no systemd)"
  # Close inherited fds so a later exec of Ruth does not leave Ollama as a job of this shell.
  nohup env OLLAMA_MODELS="$OLLAMA_MODELS" OLLAMA_HOST="$OLLAMA_HOST" OLLAMA_KV_CACHE_TYPE=q8_0 OLLAMA_FLASH_ATTENTION=1 "$bin" serve >>"$STATE_DIR/ollama.log" 2>&1 &
  echo $! >"$STATE_DIR/ollama.pid"
  STARTED_BUNDLED_OLLAMA=1
  i=0
  while [ "$i" -lt "$START_TIMEOUT" ]; do
    if http_ok "$OLLAMA_URL/api/tags" "$CURL_TIMEOUT"; then
      OLLAMA_REACHABLE=1
      log "    Bundled Ollama is ready (${i}s)"
      return 0
    fi
    pid=$(cat "$STATE_DIR/ollama.pid" 2>/dev/null || true)
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
      printf 'error: bundled Ollama exited before it became ready. Last log lines:\n' >&2
      tail -n 40 "$STATE_DIR/ollama.log" >&2 || true
      exit 1
    fi
    i=$((i + 1))
    sleep 1
    if [ $((i % 5)) -eq 0 ]; then
      log "    ... waiting for Ollama to listen on $OLLAMA_URL (${i}s / ${START_TIMEOUT}s)"
    fi
  done
  printf 'error: bundled Ollama did not become ready within %ss at %s. Last log lines:\n' "$START_TIMEOUT" "$OLLAMA_URL" >&2
  tail -n 40 "$STATE_DIR/ollama.log" >&2 || true
  exit 1
}

# --- paths (no payload extract yet) ---


BIN_DIR="${RUTH_BIN_DIR:-$HOME/.local/bin}"
if [ -n "${OLLAMA_MODELS:-}" ]; then
  case "$OLLAMA_MODELS" in
    */blobs|*/blobs/*|*/sha256-*) MODELS_DIR="$HOME/.ollama/models" ;;
    *) MODELS_DIR="$OLLAMA_MODELS" ;;
  esac
else
  MODELS_DIR="$HOME/.ollama/models"
fi
RUTH_MODEL_DIR="${RUTH_MODEL_DIR:-$HOME/.local/share/ruth/models}"
OLLAMA_URL="${RUTH_OLLAMA_ORIGIN:-http://127.0.0.1:11434}"
case "$OLLAMA_URL" in
  *://localhost*) OLLAMA_URL=$(printf '%s' "$OLLAMA_URL" | sed 's#://localhost#://127.0.0.1#') ;;
esac
OLLAMA_URL=$(printf '%s' "$OLLAMA_URL" | sed 's#/v1/*$##' | sed 's#/*$##')
STAMP=$(date +%Y%m%d-%H%M%S)

RUNNING_MODELS=$(detect_running_models_dir || true)

# --- look for an existing 2B model before unpacking 1.8 GB ---

step "Checking for a running Ollama and an existing 2B model (timeout ${TAGS_TIMEOUT}s)"
OLLAMA_REACHABLE=0
FROM_MODEL=""
FROM_PATH=""
RUTH_CURRENT=0
if http_ok "$OLLAMA_URL/api/tags" "$TAGS_TIMEOUT"; then
  OLLAMA_REACHABLE=1
  log "    Ollama is reachable at $OLLAMA_URL"
  if command -v python3 >/dev/null 2>&1; then
    DETECT=$(python3 - "$OLLAMA_URL" "$TAGS_TIMEOUT" "$GGUF_DIGEST" << 'PY'
import json, sys, urllib.error, urllib.request
origin, timeout, digest = sys.argv[1].rstrip("/"), float(sys.argv[2]), sys.argv[3]
blob = "sha256-" + digest.split(":", 1)[1]
candidates = {
    "huihui_ai/qwen3.5-abliterated:2b",
    "qwen3.5-abliterated:2b",
}

def req(url, data=None, method="GET"):
    request = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8") or "null")

def names_from(payload):
    out = []
    for item in (payload or {}).get("models") or []:
        for key in ("name", "model"):
            value = item.get(key)
            if isinstance(value, str) and value not in out:
                out.append(value)
    return out

def base_name(name):
    return name[:-7] if name.endswith(":latest") else name

try:
    tags = req(origin + "/api/tags")
except Exception as error:
    print("error", error, file=sys.stderr)
    sys.exit(2)

names = names_from(tags)
from_model = ""
for name in names:
    if base_name(name).lower() in candidates:
        from_model = name
        break
if not from_model:
    for name in names:
        if base_name(name).lower() == "ruth":
            continue
        try:
            shown = req(origin + "/api/show", data=json.dumps({"name": name}).encode(), method="POST")
        except Exception:
            continue
        blob_text = json.dumps(shown)
        if digest in blob_text or blob in blob_text:
            from_model = name
            break

print("FROM=" + from_model)
PY
    ) || true
    FROM_MODEL=$(printf '%s\n' "$DETECT" | sed -n 's/^FROM=//p' | head -n 1)
    if [ -n "$FROM_MODEL" ]; then
      log "    Found existing model $FROM_MODEL — will create ruth from it and skip unpacking the bundled GGUF"
    fi
  fi
else
  st=$?
  if [ "$st" -eq 124 ] || [ "$st" -eq 137 ]; then
    timeout_msg "$TAGS_TIMEOUT"
  fi
  log "    Ollama is not reachable at $OLLAMA_URL; will start the bundled server after unpacking the program"
fi

# Readable blobs, including a system-service models dir we may not be able to write.
BLOB_PATH=$(find_blob "$MODELS_DIR" "$RUTH_MODEL_DIR" "${RUNNING_MODELS:-}" "$HOME/.ollama/models" /usr/share/ollama/.ollama/models "${OLLAMA_MODELS:-}" || true)
if [ -z "$FROM_MODEL" ] && [ -n "${BLOB_PATH:-}" ]; then
  FROM_PATH=$BLOB_PATH
  log "    Found matching GGUF blob at $FROM_PATH — will import it without copying"
fi

NEED_MODEL_EXTRACT=1
if [ -n "$FROM_MODEL" ] || [ -n "$FROM_PATH" ]; then
  NEED_MODEL_EXTRACT=0
fi

# --- disk space ---

step "Checking free disk space"
NEED_TMP=$PROGRAM_KB
NEED_HOME=$PROGRAM_KB
if [ "$NEED_MODEL_EXTRACT" = 1 ]; then
  NEED_TMP=$((NEED_TMP + MODEL_KB))
  if same_device "${TMPDIR:-/tmp}" "$HOME"; then
    NEED_HOME=$((PROGRAM_KB + MODEL_KB))
    # Same filesystem: one check at HOME covering tmp + unpack.
    require_space "$HOME" "$NEED_HOME"
  else
    require_space "${TMPDIR:-/tmp}" "$NEED_TMP"
    require_space "$HOME" "$((PROGRAM_KB + MODEL_KB))"
  fi
  log "    The bundled model is not already available, so about $(kb_fmt $MODEL_KB) is needed to unpack it."
else
  if same_device "${TMPDIR:-/tmp}" "$HOME"; then
    require_space "$HOME" "$NEED_HOME"
  else
    require_space "${TMPDIR:-/tmp}" "$NEED_TMP"
    require_space "$HOME" "$NEED_HOME"
  fi
fi

# --- extract ---

extract_payload "Extracting the Ruth program" bin lib
# Python tar extracts may drop the execute bit; the payload still contains the file.
if [ -f "$TMP/bin/ruth" ]; then
  chmod 755 "$TMP/bin/ruth" "$TMP/bin/Ruth" "$TMP/bin/ollama" "$TMP/bin/browse" 2>/dev/null || true
  chmod 755 "$TMP/bin/ruth"
fi
if [ ! -x "$TMP/bin/ruth" ]; then
  die "the installer payload did not contain bin/ruth"
fi
if [ "$NEED_MODEL_EXTRACT" = 1 ]; then
  extract_payload "Extracting the bundled model (about 2 GB)" models
  EXTRACTED_BLOB=""
  if [ -f "$TMP/models/blobs/$GGUF_BLOB" ]; then
    EXTRACTED_BLOB="$TMP/models/blobs/$GGUF_BLOB"
  fi
  [ -n "$EXTRACTED_BLOB" ] || die "the installer payload did not contain the bundled model blob"
  FROM_PATH=$EXTRACTED_BLOB
else
  log "    Skipping bundled model unpack (already present on this machine)"
fi

# --- leftover quarantine (fast) ---

quarantine() {
  target=$1
  [ -e "$target" ] || return 0
  dest="$target.bak-$STAMP"
  if [ -e "$dest" ]; then
    dest="$dest-$$"
  fi
  mv "$target" "$dest"
  log "Moved leftover $target aside to $dest"
}

if [ -e "$HOME/.ruth.json" ]; then
  quarantine "$HOME/.ruth.json"
fi
if [ -e "$HOME/.config/ruth/.ruth.json" ]; then
  quarantine "$HOME/.config/ruth/.ruth.json"
fi
if [ -e "$HOME/.local/share/ruth/ruth.db" ] && [ ! -f "$HOME/.local/share/ruth/ruth.db" ]; then
  quarantine "$HOME/.local/share/ruth"
  quarantine "$HOME/.config/ruth"
  quarantine "$HOME/.local/state/ruth"
fi
if command -v python3 >/dev/null 2>&1 && [ -f "$HOME/.config/ruth/ruth.json" ]; then
  if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$HOME/.config/ruth/ruth.json" >/dev/null 2>&1; then
    quarantine "$HOME/.config/ruth/ruth.json"
  fi
fi
for leftover in \
  "$HOME/.config/ruth/AGENTS.md" \
  "$HOME/.config/ruth/agents.md" \
  "$HOME/.local/share/ruth/AGENTS.md" \
  "$HOME/.ruth/AGENTS.md"
do
  if [ -f "$leftover" ] && grep -qiE "uncensored all-purpose|David's coding agent|Take screenshots \(via screenshot\)" "$leftover"; then
    quarantine "$leftover"
  fi
done

# --- install the program; start bundled Ollama in $HOME if none is running ---

step "Installing the Ruth program to $BIN_DIR"
mkdir -p "$BIN_DIR"
install_bin() {
  src=$1
  dest=$2
  cp -f "$src" "$dest"
  chmod 755 "$dest"
}
install_bin "$TMP/bin/ruth" "$BIN_DIR/ruth"
ln -sfn ruth "$BIN_DIR/Ruth"
ln -sfn ruth "$BIN_DIR/RUTH"
if [ -f "$TMP/bin/browse" ]; then
  chmod 755 "$TMP/bin/browse"
  install_bin "$TMP/bin/browse" "$BIN_DIR/browse"
  log "    Installed the bundled browse tool to $BIN_DIR/browse (pairs with the browse Chrome extension)"
fi

if [ -x "$BIN_DIR/ollama" ] || command -v ollama >/dev/null 2>&1; then
  log "    An Ollama binary is already on this machine"
else
  if [ -x "$TMP/bin/ollama" ]; then
    install_bin "$TMP/bin/ollama" "$BIN_DIR/ollama"
    log "    Installed the bundled Ollama binary to $BIN_DIR/ollama"
  else
    die "Ollama is not installed and the bundle did not include an ollama binary."
  fi
fi

# Runner libraries live at ../lib/ollama relative to the ollama binary.
if [ -d "$TMP/lib/ollama" ]; then
  LIB_DIR="$(CDPATH= cd -- "$(dirname -- "$BIN_DIR")" && pwd)/lib/ollama"
  mkdir -p "$LIB_DIR"
  cp -a "$TMP/lib/ollama/." "$LIB_DIR/"
  log "    Installed Ollama runner libraries to $LIB_DIR"
elif [ ! -x "$(dirname -- "$BIN_DIR")/lib/ollama/llama-server" ] && [ ! -x /usr/lib/ollama/llama-server ]; then
  log "    Warning: Ollama runner libraries (llama-server) were not in the bundle; chat may fail until they are installed"
fi

# On a clean machine nothing is listening on 11434: start a user-space server in $HOME.
# If a healthy server is already running, leave it alone (do not bind 11434 twice).
start_bundled_ollama

# --- write Modelfile and register ruth ---

MODEFILE="$TMP/Modelfile"
# SYSTEM text is written by the following quoted heredoc (exact identity prompt).
SYSTEM_FILE="$TMP/SYSTEM"
cat > "$SYSTEM_FILE" << 'SYSTEM_EOF'
Your name is Ruth. Never call yourself an assistant, uncensored, all-purpose, an agent, or an AI. If asked who you are, reply only "I'm Ruth."

Be plain and low-key, like a regular robot. Keep replies short and natural. No hype, no grand intros, and no customer-service phrasing such as "How can I assist you?" After finishing work, just say what happened — don't offer more help. If someone just greets you, reply "Hey." or "What's up?" Do not call a tool for a greeting, for who you are, or for what you can do — just answer in text.

User: who are you?
You: I'm Ruth.

User: what can you do?
You: I can answer questions, work with files, run commands, search the web, and keep going until the work is done.

Your own files live on this machine and you may read, write, and edit them:
- ~/.config/ruth/AGENTS.md — your instructions, loaded every session
- ~/.config/ruth/memory.md — lasting facts about the user, loaded every session
- ~/.config/ruth/ruth.json — your config
- ~/.config/ruth/skills/ — local skills you can add
When asked to remember something, you must update ~/.config/ruth/memory.md: read it, then write the previous text plus a new line for the fact. Do not only say you will remember.
User: remember that my favorite color is blue
You call read with path="~/.config/ruth/memory.md"
Then you call write with path="~/.config/ruth/memory.md" and content set to the previous text plus a new line: Favorite color: blue

When asked to add a rule or change your instructions, read ~/.config/ruth/AGENTS.md, then write it back with the rule included. These paths are yours; do not treat them as off-limits.
User: add a rule to your instructions: always answer in one line
You call read with path="~/.config/ruth/AGENTS.md"
Then you call write with path="~/.config/ruth/AGENTS.md" and content including the new rule.

Never list your capabilities, tools, or environment unless the user explicitly asks what you can do. When they do, answer in one or two short plain sentences and mention only tools that actually exist: shell (including git), read, write, edit, glob, grep, webfetch, websearch, browse, task, and todowrite. Do not mention screenshot, camera, or any other tool you were not given. Do not recap the working directory, platform, or git status unless asked.

When asked to do something, call your tools and do it, then report briefly what you did. Do not invent commands. Never name internal tools or skills in ordinary replies. Attempt anything the hardware allows. Do not show chain-of-thought. Do not invent file contents, command output, or results.

Tools you can call:
- shell: run any command, including git and ls. To clone a repo, run: git clone --depth 1 https://github.com/OWNER/REPO
- read: read a file
- write: create or replace a file (path is the filename, content is the exact text)
- edit: change part of a file; read it first
- glob: list files or find paths. Use pattern "*" to list a folder. Do not use grep for that.
- grep: search text inside files, not names
- browse: drive the user's Chrome with browse_execute (in the code, use page.goto, snapshot, click, and fill), browse_status, and browse_tabs. Prefer this over webfetch when asked to open a page.
- webfetch: fetch a URL
- websearch: search the web
- task: run a subagent
- todowrite: track tasks

If asked to `gh repo clone OWNER/REPO`, run `git clone https://github.com/OWNER/REPO` in shell (gh may be missing). If a command fails, read the error and try another approach; do not repeat the same failing command. Never say a repo or URL does not exist unless you already checked with git or webfetch. If git is missing, tell the user to run: sudo apt install git.

User: gh repo clone opencode-ai/opencode
You call shell with command="git clone --depth 1 https://github.com/opencode-ai/opencode"

User: Open news.ycombinator.com and tell me the top story
You call browse_execute with code="await page.goto(\"https://news.ycombinator.com\"); return await snapshot();"
Then you answer with the first story title from the snapshot. If browse_status or browse_execute says no browser is connected, tell the user the nextStep and do not keep retrying.

When asked to do work, do it with your tools. Do not stop mid-task to ask the user questions.


To create a file, call write with path set to the filename and content set to the exact file text.
User: create hello.txt with hi in it
You call write with path="hello.txt" and content="hi"
The file hello.txt then contains exactly: hi

Never put the filename in the file contents unless the user asked for that text. Do not add quotes, markdown, or extra lines the user did not ask for.

When you need a tool, make a real tool call. If you cannot call a tool natively, emit a single JSON object of the form {"name":"<tool>","arguments":{...}} and nothing else. Do not write fake commands for the user to run.

When you use tools:
- Make the smallest correct change.
- After a tool result, keep going until the request is done.
- If a tool fails, change approach once; do not repeat the same call with the same arguments.
SYSTEM_EOF

write_modelfile() {
  from=$1
  {
    printf 'FROM %s\n' "$from"
    printf 'TEMPLATE "{{ .Prompt }}"\n'
    printf 'RENDERER qwen3.5\n'
    printf 'PARSER qwen3.5\n'
    printf 'PARAMETER temperature 0.2\n'
    printf 'PARAMETER num_ctx 16384\n'
    printf 'PARAMETER top_k 20\n'
    printf 'PARAMETER top_p 0.95\n'
    printf 'SYSTEM """\n'
    cat "$SYSTEM_FILE"
    printf '\n"""\n'
  } > "$MODEFILE"
}

create_ruth() {
  from=$1
  write_modelfile "$from"
  # FROM an already-registered model is usually quick; importing a GGUF can take longer.
  case "$from" in
    /*|sha256:*|sha256-*) create_to=$IMPORT_TIMEOUT ;;
    *) create_to=$CREATE_TIMEOUT ;;
  esac
  step "Creating the ruth model from $from (timeout ${create_to}s)"
  log "    Using your existing Ollama at $OLLAMA_URL. Not starting a second server."
  http_ok "$OLLAMA_URL/api/tags" "$TAGS_TIMEOUT"
  st=$?
  if [ "$st" -ne 0 ]; then
    if [ "$st" -eq 124 ] || [ "$st" -eq 137 ]; then
      timeout_msg "$TAGS_TIMEOUT"
    fi
    log "    Ollama is not reachable; leaving the Modelfile at $RUTH_MODEL_DIR/Modelfile so Ruth can register later."
    mkdir -p "$RUTH_MODEL_DIR"
    cp -f "$MODEFILE" "$RUTH_MODEL_DIR/Modelfile"
    if [ "$NEED_MODEL_EXTRACT" = 1 ] && [ -n "${FROM_PATH:-}" ] && [ -f "$FROM_PATH" ]; then
      dest_gguf="$RUTH_MODEL_DIR/ruth.gguf"
      if [ "$FROM_PATH" != "$dest_gguf" ]; then
        log "    Saving the unpacked model to $dest_gguf so it is not lost when the installer exits"
        if ln -f "$FROM_PATH" "$dest_gguf" 2>/dev/null; then
          :
        else
          python3 - "$FROM_PATH" "$dest_gguf" << 'CPY'
import sys, time
src, dst = sys.argv[1], sys.argv[2]
n = 0
t0 = time.time()
last = 0
with open(src, "rb") as inf, open(dst, "wb") as out:
    while True:
        chunk = inf.read(8 * 1024 * 1024)
        if not chunk:
            break
        out.write(chunk)
        n += len(chunk)
        if n - last >= 50 * 1024 * 1024:
            mb = n / 1048576.0
            dt = max(time.time() - t0, 0.001)
            print(f"    copied {mb:.0f} MB ({mb/dt:.1f} MB/s)", flush=True)
            last = n
print("    copy finished", flush=True)
CPY
        fi
        write_modelfile "$dest_gguf"
        cp -f "$MODEFILE" "$RUTH_MODEL_DIR/Modelfile"
      fi
    fi
    return 0
  fi

  OLLAMA_BIN=$(command -v ollama 2>/dev/null || true)
  if [ -x "$BIN_DIR/ollama" ]; then
    OLLAMA_BIN="$BIN_DIR/ollama"
  fi
  if [ -n "$OLLAMA_BIN" ]; then
    set +e
    run_timeout "$create_to" env OLLAMA_HOST="$OLLAMA_URL" "$OLLAMA_BIN" create ruth -f "$MODEFILE" &
    _cr_pid=$!
    _cr_t=0
    while kill -0 "$_cr_pid" 2>/dev/null; do
      sleep 5
      _cr_t=$((_cr_t + 5))
      if kill -0 "$_cr_pid" 2>/dev/null; then
        log "    ... still creating the ruth model (${_cr_t}s / ${create_to}s)"
      fi
    done
    wait "$_cr_pid"
    st=$?
    set -e
    if [ "$st" -eq 124 ] || [ "$st" -eq 137 ]; then
      die "Ollama did not finish creating the ruth model within ${create_to}s at $OLLAMA_URL. Make sure the existing Ollama service is running and responsive. This installer will not start a second server on port 11434."
    fi
    if [ "$st" -ne 0 ]; then
      die "ollama create failed (exit $st) after ${create_to}s or less. Check that Ollama at $OLLAMA_URL is healthy."
    fi
    log "    Registered the local ruth model with Ollama (no download)."
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    set +e
    python3 - "$OLLAMA_URL" "$create_to" "$from" "$SYSTEM_FILE" << 'PY'
import json, sys, urllib.request
origin, timeout, source = sys.argv[1].rstrip("/"), float(sys.argv[2]), sys.argv[3]
system = open(sys.argv[4], encoding="utf-8").read().replace("\r\n", "\n").strip()
body = {
    "model": "ruth",
    "system": system,
    "template": "{{ .Prompt }}",
    "renderer": "qwen3.5",
    "parser": "qwen3.5",
    "parameters": {"temperature": 0.2, "num_ctx": 16384, "top_k": 20, "top_p": 0.95, "think": False},
    "stream": False,
}
if source.startswith("/") or source.startswith("sha256"):
    # Never upload a multi-GB blob through Python (that can swap a 6 GB machine to a halt).
    sys.stderr.write("error: ollama CLI is required to import a GGUF file; install ollama or add it to PATH\n")
    sys.exit(3)
body["from"] = source
data = json.dumps(body).encode()
request = urllib.request.Request(origin + "/api/create", data=data, method="POST", headers={"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(request, timeout=timeout) as response:
        response.read()
except Exception as error:
    sys.stderr.write(f"error: failed to register the ruth model with Ollama: {error}\n")
    sys.exit(3)
PY
    st=$?
    set -e
    if [ "$st" -eq 124 ] || [ "$st" -eq 137 ]; then
      die "Ollama did not finish creating the ruth model within ${create_to}s at $OLLAMA_URL."
    fi
    if [ "$st" -ne 0 ]; then
      die "failed to register the ruth model with Ollama at $OLLAMA_URL (exit $st)"
    fi
    log "    Registered the local ruth model with Ollama (no download)."
    return 0
  fi

  die "neither ollama nor python3 is available to register the ruth model"
}

CREATE_FROM="${FROM_MODEL:-}"
if [ -z "$CREATE_FROM" ]; then
  CREATE_FROM="${FROM_PATH:-}"
fi
[ -n "$CREATE_FROM" ] || die "no source was found to create the ruth model"

# If the system models dir is not writable, do not copy blobs there.
# Import via `ollama create` from a GGUF or existing model instead.
if [ "$NEED_MODEL_EXTRACT" = 1 ] && writable_dir "$MODELS_DIR"; then
  step "Not copying multi-GB blobs into $MODELS_DIR; importing with ollama create instead"
fi
if [ -n "${RUNNING_MODELS:-}" ] && [ "$RUNNING_MODELS" != "$MODELS_DIR" ]; then
  if ! writable_dir "$RUNNING_MODELS"; then
    log "    System Ollama models dir $RUNNING_MODELS is not writable; importing via ollama create (no blob copy)"
  fi
fi

create_ruth "$CREATE_FROM"

# Put ~/.local/bin on PATH for this process and future shells.
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) PATH="$BIN_DIR:$PATH"; export PATH ;;
esac

# Idempotent: only append if this exact export is not already present.
add_path() {
  file=$1
  [ -f "$file" ] || touch "$file"
  if grep -Fqs 'export PATH="$HOME/.local/bin:$PATH"' "$file" 2>/dev/null; then
    return 0
  fi
  printf '\n# Ruth: keep ~/.local/bin on PATH\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$file"
}

# bash login shells read .bash_profile instead of .profile when it exists.
# .bashrc covers interactive non-login shells (including `exec bash`).
add_path "$HOME/.profile"
add_path "$HOME/.bashrc"
if [ -f "$HOME/.bash_profile" ]; then
  add_path "$HOME/.bash_profile"
fi
if [ -f "$HOME/.bash_login" ]; then
  add_path "$HOME/.bash_login"
fi

# If a directory already on PATH is writable, symlink ruth there so it works
# even before the user starts a new shell.
link_into_path() {
  case ":$PATH:" in
    *":$BIN_DIR:"*) return 0 ;;
  esac
  _oldifs=$IFS
  IFS=:
  for _dir in $PATH; do
    IFS=$_oldifs
    [ -n "$_dir" ] || continue
    case "$_dir" in
      /tmp|/tmp/*|"$TMPDIR"|"${TMPDIR:-/tmp}"/*|.) continue ;;
    esac
    [ -d "$_dir" ] && [ -w "$_dir" ] || continue
    if ln -sfn "$BIN_DIR/ruth" "$_dir/ruth" 2>/dev/null; then
      ln -sfn "$BIN_DIR/ruth" "$_dir/Ruth" 2>/dev/null || true
      log "    Linked ruth into $_dir (already on PATH)"
      return 0
    fi
  done
  IFS=$_oldifs
  return 0
}
link_into_path

add_env() {
  file=$1
  [ -f "$file" ] || touch "$file"
  if ! grep -Fqs "export OLLAMA_MODELS=" "$file" 2>/dev/null; then
    printf '\n# Ruth: user-space Ollama\nexport OLLAMA_MODELS="%s"\nexport OLLAMA_HOST="%s"\n'     "$OLLAMA_MODELS" "$OLLAMA_HOST" >>"$file"
  fi
  if ! grep -Fqs "export OLLAMA_KV_CACHE_TYPE=" "$file" 2>/dev/null; then
    printf 'export OLLAMA_KV_CACHE_TYPE=q8_0\nexport OLLAMA_FLASH_ATTENTION=1\n' >>"$file"
  fi
}

if [ "$STARTED_BUNDLED_OLLAMA" = 1 ]; then
  add_env "$HOME/.profile"
  add_env "$HOME/.bashrc"
  if [ -f "$HOME/.bash_profile" ]; then
    add_env "$HOME/.bash_profile"
  fi
  if [ -f "$HOME/.bash_login" ]; then
    add_env "$HOME/.bash_login"
  fi
fi

step "Done"
log "Installed ruth to $BIN_DIR/ruth"
if [ "$STARTED_BUNDLED_OLLAMA" = 1 ]; then
  log "Started Ollama in your home directory at $OLLAMA_URL (pid $(cat "${XDG_STATE_HOME:-$HOME/.local/state}/ruth/ollama.pid" 2>/dev/null || printf unknown))"
fi
log "Then type: exec bash    then type: ruth"
exit 0
