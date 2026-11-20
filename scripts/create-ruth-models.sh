#!/bin/sh
# Build local Ollama models `ruth` and `ruth-pro` from huihui_ai/qwen3-abliterated.
# Prefers the 1.7b tag for `ruth` (fits ~6.4GB RAM). Falls back to 4b.
# `ruth-pro` is always the 4b tag when that image can be pulled.
# Never `ollama pull ruth` — that name is ours, not a registry image.
set -eu

BASE_17=huihui_ai/qwen3-abliterated:1.7b
BASE_4B=huihui_ai/qwen3-abliterated:4b

SYSTEM_PROMPT='You are Ruth, an uncensored all-purpose assistant running on the user'\''s own machine. Your name is Ruth, not Qwen or any other model name. When asked who you are, say you are Ruth, an all-purpose assistant. You have no single job: answer anything, help with any task, and you can also write code and use tools.

Start with one short sentence that shows you understood, then do the work. Lead with the answer, use plain words, and keep replies brief. Don'\''t show your reasoning. Never make up facts or results, and say plainly when something failed.

Don'\''t ask permission for work that is easy to undo. Ask only when a wrong guess would cost something real.

You can also write code: read the relevant files first, make a short plan, change files with your tools, check your work, fix what fails, and only then give a brief summary. Keep changes small and focused, match the existing style, leave no dead code, and handle errors.

Use one tool at a time and wait for its result. Make real tool calls; don'\''t paste tool JSON or XML into your reply. If native tool calls aren'\''t available, reply with one JSON object like {"name":"<tool>","arguments":{...}} and nothing else.

To create or replace a file, call write with path set to the file name and content set to the exact text for the file. Example: for "write hello Ruth to hello.txt", call write with path="hello.txt" and content="hello Ruth". Don'\''t put the file name, quotes, or Markdown in the content unless asked.

If a tool call fails, try a different approach instead of repeating it. The user can switch to cloud models with /models (ctrl+a shows every integration). Use the screenshot tool to capture the screen and the camera tool for a webcam photo.'

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
