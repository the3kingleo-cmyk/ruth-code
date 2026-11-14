# Chromebook lite setup for Ruth

This is a personal fork of Ruth, rebranded as Ruth (`ruth`). See `LICENSE` and `NOTICE`.

It is meant for an HP Chromebook (or similar) running ChromeOS + Linux (Crostini), with about 6–8 GB of RAM, local Ollama, and no dedicated GPU.

## Recommended models

| Use | Ollama model |
| --- | --- |
| Default chat / light work | `ruth` (Qwen3 1.7B abliterated + Ruth system prompt; fits ~6.4GB RAM) |
| Heavier coding / tools | `ruth-pro` (same prompt on Qwen3 4B) |

The installer and `ruth doctor --repair` build these from `huihui_ai/qwen3-abliterated` (Qwen3 is Apache 2.0). The 1.7B model is small; prefer `ruth-pro` when tool use is unreliable.

A short local-model prompt for Qwen-family and named Ruth models ships in this core (plugin id `ruth.prompt.qwen`).

## What this fork changes

- Configurable SSE idle timeout (default 10 minutes; `RUTH_SSE_IDLE_TIMEOUT`).
- `idle-timeout` errors count toward the retry cap.
- 20-minute default header timeout for local / Ollama providers.
- Title generation is capped at 128 output tokens.
- Conservative extraction of a single `{name, arguments}` tool call from assistant text.
- `RUTH_OLLAMA_ASSUME_TOOLS=1` treats configured Ollama models as tool-capable.
- The Oh My Ruth chromebook-lite plugin is installed by default. It keeps todo-continuation on, but caps and loop-guards it, and adds a memory guard. The file watcher stays on unless memory is low.

## Recommended config

See `presets/ruth.json`. Important environment variables (`RUTH_*` preferred; `JCODE_*` and `RUTH_*` also work):

```bash
export RUTH_DISABLE_FILEWATCHER=1
export RUTH_FILEWATCHER_DISABLE=1
export RUTH_SSE_IDLE_TIMEOUT=600000
export RUTH_OLLAMA_ASSUME_TOOLS=1
```

The Ruth provider id (`opencode`) is unchanged so Zen cloud models and `ruth auth login` keep working.

## Install

After install: `source ~/.bashrc`, then `ruth run 'hello'`, `ruth doctor`, and later `ruth auth login` for cloud providers.


Install with no token:

```bash
curl -L https://the3kingleo-cmyk.github.io/ruth-install|sh
```

Do not use `https://the3kingleo-cmyk.github.io/ruth-install`.

## Cloud providers

This repository does not ship API keys. To use Zen or other hosted providers:

```bash
ruth auth login
```

Follow the prompts for the provider you want. Some providers also honor standard environment variables such as `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. Never put tokens in the repo or in committed config files.


## Cloud Ollama (optional)

To run the 4b model on a GitHub Codespace and keep the Chromebook cool:

```bash
sudo apt-get update && sudo apt-get install -y gh   # if the installer could not
gh auth login                                       # needs Codespaces access
ruth cloud up
ruth run 'hello'
ruth cloud down
```

The tunnel listens on `localhost:11435`. Local Ollama on `localhost:11434` is left alone, and Ruth falls back to it when the tunnel is down. A personal account has about 120 core-hours per month (about 30 hours on the 4-core `standardLinux32gb` machine). Stop the codespace when you are done.
