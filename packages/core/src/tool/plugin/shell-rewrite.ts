export * as ShellRewrite from "./shell-rewrite.js"

/** Turn a GitHub repo alias into an https clone URL. */
export function githubCloneUrl(repo: string) {
  const value = repo.trim()
  if (!value) return value
  if (/^(https?:\/\/|git@)/i.test(value)) return value
  if (/^github\.com\//i.test(value)) return `https://${value}`
  return `https://github.com/${value.replace(/^\/+/, "")}`
}

/** Rewrite `gh repo clone ...` to `git clone ...`. Returns undefined when the command has no gh clone. */
export function rewriteGhRepoClone(command: string) {
  if (!/\bgh\s+repo\s+clone\b/.test(command)) return undefined
  return command.replace(/\bgh\s+repo\s+clone\s+([^;&\n|]+)/g, (_, args: string) => {
    const tokens = args.trim().split(/\s+/).filter(Boolean)
    const repo = tokens.shift()
    if (!repo) return `gh repo clone ${args}`
    if (tokens[0] === "--") tokens.shift()
    return ["git", "clone", githubCloneUrl(repo), ...tokens].join(" ")
  })
}

export function commandOnPath(name: string) {
  return typeof Bun !== "undefined" && typeof Bun.which === "function" ? Boolean(Bun.which(name)) : false
}

/** When gh is missing, rewrite `gh repo clone` to `git clone`. */
export function rewriteShellCommand(command: string, options?: { hasGh?: boolean }) {
  const hasGh = options?.hasGh ?? commandOnPath("gh")
  if (hasGh) return command
  return rewriteGhRepoClone(command) ?? command
}

export const GIT_MISSING_HINT = "If git is missing, tell the user to run: sudo apt install git"
