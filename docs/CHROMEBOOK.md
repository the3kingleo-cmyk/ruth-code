# Chromebook lite setup

This is a **personal, non-commercial** copy of oh-my-openagent under the Sustainable Use License. See `LICENSE.md` and `NOTICE.md`.

It is meant for an HP Chromebook (or similar) running ChromeOS + Linux (Crostini), with about 6–8 GB of RAM, local Ollama, and no dedicated GPU.

## Recommended models

| Use | Ollama model |
| --- | --- |
| Coding | `huihui_ai/qwen3-abliterated:4b` |
| Chat / light work | `huihui_ai/qwen3-abliterated:1.7b` |

The 1.7b model is often too small to use tools reliably. Prefer 4b for coding.

A short local-model prompt for Qwen-family models ships in the patched OpenCode / Jarvis Code core (`opencode.prompt.qwen`).

## What this fork changes

- At most **one** background agent at a time by default (was five). A config value of `0` is **not** unlimited; it means 1.
- At most **two** background tasks running in total (`background_task.maxTotal`).
- `todo-continuation-enforcer` is **off** unless you set `disabled_hooks: []` (or a list that does not include it).
- Ralph Loop and Goal stay **off** by default (same as upstream).
- Identical repeated tool calls are blocked after 3 repeats in a row.
- New background agents are refused when `/proc/meminfo` `MemAvailable` is under 768 MiB (`background_task.minFreeMemoryMb`).
- A hard cap of 8 todo-continuation injections per session, if you turn that hook back on.
- Timeout retries with backoff for quiet/local models (`local-model-patience`). The plugin does **not** patch OpenCode's 45-second client SSE idle timeout or its `idle-timeout` retry accounting; those are fixed in the patched OpenCode / Jarvis Code core.

## Recommended OpenCode / Jarvis Code config

See `presets/chromebook-opencode.json` and `presets/chromebook-omo.json`. Important environment variables (OpenCode names; Jarvis Code also accepts `JCODE_*`):

```bash
export OPENCODE_DISABLE_FILEWATCHER=1
export OPENCODE_FILEWATCHER_DISABLE=1
export OPENCODE_SSE_IDLE_TIMEOUT=600000
export OPENCODE_OLLAMA_ASSUME_TOOLS=1
```

In `opencode.json` / `jcode.json`, give the local Ollama provider a large `headerTimeout` (20 minutes) or `false`, and mark your models as tool-capable:

```json
{
  "provider": {
    "ollama": {
      "options": { "headerTimeout": 1200000 },
      "models": {
        "huihui_ai/qwen3-abliterated:4b": {
          "capabilities": { "tools": true }
        }
      }
    }
  }
}
```

OpenCode already writes SSE heartbeats every 15 seconds. The patched core also lengthens the client idle timeout (default 10 minutes, configurable) and caps `idle-timeout` retries.

## Install

Do not publish this plugin to npm. Point OpenCode's `plugins` array at a **local directory** after building this repo (`./` or `file://` paths are supported; the path must be a directory with a package entry).

The install script clones this private repo (using `GITHUB_TOKEN` if needed), installs bun if missing, builds the plugin, backs up `~/.config/opencode/opencode.json` and `~/.config/jcode/jcode.json` if present, and adds the plugin path.

```bash
read -rsp "GitHub token: " GITHUB_TOKEN; echo
export GITHUB_TOKEN
curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.raw" \
  "https://api.github.com/repos/the3kingleo-cmyk/oh-my-openagent/contents/scripts/install-chromebook.sh?ref=chromebook-lite" \
  | bash
```

Or, if you already cloned the repo:

```bash
bash scripts/install-chromebook.sh
```

## Limits that still need the patched core (Jarvis Code)

These are **not** fully fixable inside this plugin alone:

- The 45-second client SSE idle timeout (now configurable / 10-minute default in Jarvis Code).
- `idle-timeout` retries that were not counted toward the timeout retry cap.
- Unbounded title-generation output tokens on local thinking models.
- Extracting a `{name, arguments}` tool call from assistant text when the model cannot emit native tool calls.
- Treating Ollama models as tool-capable when `/api/show` omits `tools`, via a config/env override.
- A short Qwen local-model system prompt.

Use the Jarvis Code (`jcode`) build from `the3kingleo-cmyk/jarvis-code` together with this plugin.
