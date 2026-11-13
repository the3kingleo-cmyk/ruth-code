# Chromebook lite setup for Ruth

This is a personal fork of OpenCode, rebranded as Ruth (`ruth`). See `LICENSE` and `NOTICE`.

It is meant for an HP Chromebook (or similar) running ChromeOS + Linux (Crostini), with about 6–8 GB of RAM, local Ollama, and no dedicated GPU.

## Recommended models

| Use | Ollama model |
| --- | --- |
| Coding / tools | `huihui_ai/qwen3-abliterated:4b` (recommended) |
| Chat / light work | `huihui_ai/qwen3-abliterated:1.7b` |

The 1.7b model is often too small to use tools reliably. Prefer 4b for coding.

A short local-model prompt for Qwen-family models ships in this core (`opencode.prompt.qwen`).

## What this fork changes

- Configurable SSE idle timeout (default 10 minutes; `RUTH_SSE_IDLE_TIMEOUT`).
- `idle-timeout` errors count toward the retry cap.
- 20-minute default header timeout for local / Ollama providers.
- Title generation is capped at 128 output tokens.
- Conservative extraction of a single `{name, arguments}` tool call from assistant text.
- `RUTH_OLLAMA_ASSUME_TOOLS=1` treats configured Ollama models as tool-capable.
- The Oh My OpenCode chromebook-lite plugin (optional) lowers background concurrency, caps loops, and adds a memory guard.

## Recommended config

See `presets/ruth.json`. Important environment variables (`RUTH_*` preferred; `JCODE_*` and `OPENCODE_*` also work):

```bash
export RUTH_DISABLE_FILEWATCHER=1
export RUTH_FILEWATCHER_DISABLE=1
export RUTH_SSE_IDLE_TIMEOUT=600000
export RUTH_OLLAMA_ASSUME_TOOLS=1
```

The OpenCode provider id (`opencode`) is unchanged so OpenCode Zen cloud models and `ruth auth login` keep working.

## Install

Use `scripts/install.sh` with a GitHub token that can read `the3kingleo-cmyk/ruth-code`. Do not use `https://opencode.ai/v2/install`.

## Cloud providers

This repository does not ship API keys. To use OpenCode Zen or other hosted providers:

```bash
ruth auth login
```

Follow the prompts for the provider you want. Some providers also honor standard environment variables such as `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. Never put tokens in the repo or in committed config files.
