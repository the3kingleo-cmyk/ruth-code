# Ruth

Ruth is a local, Chromebook-oriented AI coding agent maintained by David Anderson (the3kingleo-cmyk).

This is the coding-agent product named **Ruth**. Source lives in `the3kingleo-cmyk/ruth-code`.

- **CLI:** `ruth`
- **Config:** `ruth.json` / `ruth.jsonc` in the project or `~/.config/ruth/` (also reads `.ruth/` and `jcode.json`)
- **Data:** `~/.local/share/ruth`
- **Env:** `RUTH_*` (with `JCODE_*` accepted as a fallback)
- **License:** MIT. See `LICENSE` and `NOTICE`.

This tree includes local-model patches: a configurable SSE idle timeout (default 10 minutes), `idle-timeout` retry capping, a 20-minute Ollama header timeout, a 128-token title cap, a conservative text tool-call extractor, a short Qwen system prompt, and an Ollama tools override (`RUTH_OLLAMA_ASSUME_TOOLS=1`).

Zen and other cloud providers still work. This repo does not include API keys. Sign in with:

```bash
ruth auth login
```

You can also set provider keys in the environment (for example `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) if a provider documents that. Do not commit keys.

Install from the public [ruth-install](https://github.com/the3kingleo-cmyk/ruth-install) repo (no GitHub token required).

```bash
curl -L https://the3kingleo-cmyk.github.io/ruth-install|sh
```

The installer places `ruth` in `~/.local/bin`, adds that directory to `PATH`, writes a default Ollama config, installs Ollama if it is missing, pulls `huihui_ai/qwen3-abliterated:1.7b`, and installs the Chromebook-lite Oh My Ruth plugin unless you set `INSTALL_PLUGIN=0`. Then run `ruth run 'hello'`. Use `ruth doctor` to check and repair the setup, and `ruth upgrade` or `ruth self-update` to install a newer public release (sha256-verified, with rollback). A token is optional and only needed if you point those commands at a private repo.

Optional cloud Ollama (GitHub Codespace, tunneled to `localhost:11435`; local Ollama on `11434` is the automatic fallback):

```bash
ruth cloud up
ruth run 'hello'
ruth cloud status
ruth cloud down    # stop the codespace so it stops using free hours
```

A personal GitHub account includes about 120 core-hours per month. The default `standardLinux32gb` machine has 4 cores, so that is about **30 clock hours** per month. Always run `ruth cloud down` when you are done. See `docs/CLOUD.md`.

A default Ollama preset is in `presets/ruth.json`. The 1.7b model is included for light chat; **4b is recommended when you need tools**.

Only install Ruth from the ruth-install releases above.

Issues and source: https://github.com/the3kingleo-cmyk/ruth-code

Docs: https://github.com/the3kingleo-cmyk/ruth-code
Install: https://github.com/the3kingleo-cmyk/ruth-install
