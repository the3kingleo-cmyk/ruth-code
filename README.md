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

Install from the public [ruth-install](https://github.com/the3kingleo-cmyk/ruth-install) repo (no GitHub token required). Do not use the public `https://opencode.ai/v2/install` command from the upstream README below; that installs official OpenCode, not this fork.

```bash
curl -fsSL https://raw.githubusercontent.com/the3kingleo-cmyk/ruth-install/main/install.sh | bash
```

The installer places `ruth` in `~/.local/bin`, adds that directory to `PATH`, writes a default Ollama config, installs Ollama if it is missing, pulls `huihui_ai/qwen3-abliterated:1.7b`, and installs the Chromebook-lite Oh My OpenCode plugin unless you set `INSTALL_PLUGIN=0`. Then run `ruth run 'hello'`. Use `ruth doctor` to check and repair the setup, and `ruth upgrade` or `ruth self-update` to install a newer public release (sha256-verified, with rollback). A token is optional and only needed if you point those commands at a private repo.

A default Ollama preset is in `presets/ruth.json`. The 1.7b model is included for light chat; **4b is recommended when you need tools**.

The upstream OpenCode README follows.

---

<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset=".github/assets/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/assets/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/assets/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/@opencode/cli"><img alt="npm" src="https://img.shields.io/npm/v/@opencode/cli?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/release.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/release.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![OpenCode Terminal UI](services/site/public/v1/docs/assets/lander/screenshot.png)](https://opencode.ai)

---

### Installation

```bash
# YOLO
curl -fsSL https://opencode.ai/v2/install | bash

# Package managers
npm i -g @opencode/cli@latest      # or bun/pnpm/yarn
brew install anomalyco/tap/opencode-v2 # macOS and Linux (recommended, always up to date)
brew install opencode              # macOS and Linux (official brew formula, updated less)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-beta              # Arch Linux (Latest from AUR)
mise use -g opencode               # Any OS
nix run github:anomalyco/opencode  # Nix
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

OpenCode is also available as a desktop application. Download it from [opencode.ai/download](https://opencode.ai/download).

| Platform              | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-win-x64.exe`     |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
```

#### Installation Directory

The install script installs OpenCode to `$HOME/.opencode/bin`.

### Agents

OpenCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents).

### Documentation

For more info on how to configure OpenCode, [**head over to our docs**](https://opencode.ai/docs).

### Contributing

If you're interested in contributing to OpenCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on OpenCode

If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with us in any way.

---

**Join our community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
