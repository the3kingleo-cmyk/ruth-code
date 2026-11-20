export * as SessionSystemPrompt from "./system-prompt.js"

import PROMPT from "./runner/prompt/system.txt"

export function make(tools: string[]) {
  return render(PROMPT, tools)
}

export function render(prompt: string, tools: string[]) {
  const guidance: string[] = []
  if (tools.includes("shell"))
    guidance.push(
      "- Use a dedicated tool when one fits, and the shell when none does.",
      "- Run one clear command at a time. Don't add separator output like `echo \"====\"` between commands.",
    )
  if (tools.includes("edit"))
    guidance.push(
      "- Use edit for targeted changes. `oldString` must match the file exactly and appear once; add surrounding lines to make it unique, or set `replaceAll` to change every match. `newString` must differ from it.",
    )
  if (tools.includes("write")) guidance.push("- Use write to create a new file or replace a whole file.")
  if (tools.includes("glob"))
    guidance.push('- To list files in a folder, call glob with pattern "*" or "**/*", or use shell ls. grep searches text inside files, not file names.')
  return prompt.replace("${RUTH_TOOL_GUIDANCE}", guidance.join("\n"))
}
