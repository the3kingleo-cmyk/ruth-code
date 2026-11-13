# Ruth

Personal, Chromebook-oriented fork of [OpenCode](https://github.com/anomalyco/opencode) by [anomalyco](https://github.com/anomalyco), maintained for David Anderson (the3kingleo-cmyk).

This is the coding-agent product named **Ruth**. The public GitHub repo `the3kingleo-cmyk/ruth` is a different project and is not this tree. This private repo is `the3kingleo-cmyk/ruth-code`.

- **CLI:** `ruth`
- **Config:** `ruth.json` / `ruth.jsonc` in the project or `~/.config/ruth/` (falls back to `jcode.json`, `opencode.json`, `.ruth/`, and `.opencode/`)
- **Data:** `~/.local/share/ruth`
- **Env:** `RUTH_*`, with `JCODE_*` and `OPENCODE_*` accepted as fallbacks
- **License:** MIT. The original copyright notice is kept; David's copyright is added above it. See `LICENSE` and `NOTICE`.

This tree includes local-model patches: a configurable SSE idle timeout (default 10 minutes), `idle-timeout` retry capping, a 20-minute Ollama header timeout, a 128-token title cap, a conservative text tool-call extractor, a short Qwen system prompt, and an Ollama tools override (`RUTH_OLLAMA_ASSUME_TOOLS=1`).

OpenCode Zen and other cloud providers still work. This repo does not include API keys. Sign in with:

```bash
ruth auth login
```

You can also set provider keys in the environment (for example `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) if a provider documents that. Do not commit keys.

Install from the public [ruth-install](https://github.com/the3kingleo-cmyk/ruth-install) repo (no GitHub token required). Do not use `https://opencode.ai/v2/install`; that installs official OpenCode, not Ruth.

```bash
curl -L https://the3kingleo-cmyk.github.io/ruth-install|sh
```

The installer places `ruth` in `~/.local/bin`, adds that directory to `PATH`, writes a default Ollama config, installs Ollama if it is missing, pulls `huihui_ai/qwen3-abliterated:1.7b`, and installs the Chromebook-lite Oh My OpenCode plugin unless you set `INSTALL_PLUGIN=0`. Then run `ruth run 'hello'`. Use `ruth doctor` to check and repair the setup, and `ruth upgrade` or `ruth self-update` to install a newer public release (sha256-verified, with rollback). A token is optional and only needed if you point those commands at a private repo.

Optional cloud Ollama (GitHub Codespace, tunneled to `localhost:11435`; local Ollama on `11434` is the automatic fallback):

```bash
ruth cloud up
ruth run 'hello'
ruth cloud status
ruth cloud down    # stop the codespace so it stops using free hours
```

A personal GitHub account includes about 120 core-hours per month. The default `standardLinux32gb` machine has 4 cores, so that is about **30 clock hours** per month. Always run `ruth cloud down` when you are done. See `docs/CLOUD.md`.

A default Ollama preset is in `presets/ruth.json`. The 1.7b model is included for light chat; **4b is recommended when you need tools**.

Upstream OpenCode (anomalyco/opencode) is the reference project this tree is forked from. License and NOTICE credits to the original authors stay in `LICENSE` and `NOTICE`. Do not install from opencode.ai, Homebrew's `opencode` formula, or `anomalyco/tap` — those are official OpenCode, not Ruth.

Issues and source: https://github.com/the3kingleo-cmyk/ruth-code

Docs and install: https://github.com/the3kingleo-cmyk/ruth-install
