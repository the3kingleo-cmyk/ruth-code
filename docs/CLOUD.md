# Ruth cloud (Ollama in a GitHub Codespace)

`ruth cloud` starts a Codespace from the private `the3kingleo-cmyk/ruth-codespace` repo, serves Ollama there, and tunnels it to this machine.

This is **not** `the3kingleo-cmyk/ruth-cloud` (that repo holds private memories, skills, and tools).

## Commands

```bash
ruth cloud up        # find or create, wait for Ollama, tunnel 11434 -> localhost:11435
ruth run 'hello'     # prefers the tunnel when it is healthy
ruth cloud status    # state, tunnel, session hours estimate
ruth cloud logs
ruth cloud down      # stop the codespace (does not delete it) to save free hours
ruth doctor          # includes cloud checks; Ruth still works locally if cloud is down
```

## Machine and idle timeout

- Machine: `standardLinux32gb` (4 cores, 16 GB RAM, 32 GB storage)
- Idle timeout: 4 hours (`240m`), the usual personal-account maximum
- Retention after stop: 30 days, so pulled models stay on disk

Models pulled inside the codespace: `huihui_ai/qwen3-abliterated:4b` and `:1.7b`.

## Fallback

The local tunnel uses port **11435** so a local Ollama on **11434** is not disturbed. Ruth prefers the cloud origin when `/api/tags` on 11435 is healthy, and automatically uses `http://127.0.0.1:11434` when the tunnel is down.

## Free hours

GitHub personal accounts include about **120 core-hours per month**. A 4-core machine uses that as about **30 clock hours**. `ruth cloud status` estimates the current session only; GitHub does not always expose remaining monthly hours through the API. Check https://github.com/settings/billing for the exact remaining allowance.

Always run `ruth cloud down` when you are done.

## Required GitHub permission

- Classic personal access token: `codespace` and `repo` scopes, then `gh auth login` or `gh auth refresh -h github.com -s codespace,repo`
- Fine-grained token: Codespaces Read and Write on `the3kingleo-cmyk/ruth-codespace`, plus any account-level Codespaces permission shown in the token settings

The GitHub CLI (`gh`) must be installed and authenticated. The public installer tries to install `gh` when it can do so without a password prompt.
