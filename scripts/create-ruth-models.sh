#!/bin/sh
# Build local Ollama models `ruth` and `ruth-pro` from huihui_ai/qwen3-abliterated.
# Prefers the 1.7b tag for `ruth` (fits ~6.4GB RAM). Falls back to 4b.
# `ruth-pro` is always the 4b tag when that image can be pulled.
# Never `ollama pull ruth` — that name is ours, not a registry image.
set -eu

BASE_17=huihui_ai/qwen3-abliterated:1.7b
BASE_4B=huihui_ai/qwen3-abliterated:4b

SYSTEM_PROMPT='You are Ruth, David'\''s coding agent. Your name is Ruth. When asked your name or who you are, say you are Ruth.

Be brief and concrete. Do not show chain-of-thought.

When you need to create or overwrite a file, call the write tool.
- path is the filename only (for example hello.txt)
- content is the exact text to put inside the file, never the filename

Example:
User: write hello Ruth to hello.txt
You call write with path="hello.txt" and content="hello Ruth"
The file hello.txt then contains exactly: hello Ruth

Never put the filename in the file contents unless the user asked for that text. Do not add quotes, markdown, or extra lines the user did not ask for.

Tools: when you need a tool, make a real tool call. Do not write tool JSON or XML in your reply. If you cannot call a tool natively, emit a single JSON object of the form {"name":"<tool>","arguments":{...}} and nothing else.

Coding rules:
- Read a file before you edit it.
- Make the smallest correct change.
- After a tool result, keep going until the request is done.
- If a tool fails, change approach once; do not repeat the same call with the same arguments.'

has_model() {
  ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$1" && return 0
  ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$1:latest" && return 0
  return 1
}

pull_base() {
  tag=$1
  if has_model "$tag"; then
    echo "Base model already present: $tag"
    return 0
  fi
  echo "Pulling $tag …"
  ollama pull "$tag"
}

write_modelfile() {
  dest=$1
  from=$2
  {
    printf 'FROM %s\n' "$from"
    printf 'PARAMETER temperature 0.2\n'
    printf 'SYSTEM """\n'
    printf '%s\n' "$SYSTEM_PROMPT"
    printf '"""\n'
  } > "$dest"
}

create_named() {
  name=$1
  from=$2
  tmp=$(mktemp)
  write_modelfile "$tmp" "$from"
  echo "Creating Ollama model $name from $from …"
  if ollama create "$name" -f "$tmp"; then
    rm -f "$tmp"
    echo "Created $name"
    return 0
  fi
  rm -f "$tmp"
  echo "Failed to create $name" >&2
  return 1
}

if ! command -v ollama >/dev/null 2>&1; then
  echo "ollama is not on PATH" >&2
  exit 1
fi

ruth_from=""
if pull_base "$BASE_17"; then
  ruth_from=$BASE_17
elif pull_base "$BASE_4B"; then
  echo "1.7b was not available; building ruth on 4b"
  ruth_from=$BASE_4B
else
  echo "Could not pull $BASE_17 or $BASE_4B" >&2
  exit 1
fi

create_named ruth "$ruth_from" || exit 1

# ruth-pro is the 4b variant when possible. Do not fail the script if 4b is too large
# for this machine after `ruth` already exists (e.g. 1.7b-only Chromebook).
if [ "$ruth_from" = "$BASE_4B" ] || pull_base "$BASE_4B"; then
  if create_named ruth-pro "$BASE_4B"; then
    :
  else
    echo "Warning: ruth-pro (4b) was not created" >&2
  fi
else
  echo "Warning: skipped ruth-pro because $BASE_4B could not be pulled" >&2
fi

ollama list | awk 'NR==1 || $1 ~ /^(ruth|ruth-pro|huihui_ai\/qwen3-abliterated)/'
