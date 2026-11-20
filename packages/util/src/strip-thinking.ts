/** Remove Qwen/Ollama chain-of-thought that leaked into visible assistant text. */
const THINK_TAG = /<think>[\s\S]*?(?:<\/think>|$)/gi
const THINKING_TAG = /<thinking>[\s\S]*?(?:<\/thinking>|$)/gi
const COT_OPEN =
  /^(?:Okay,\s+the user\b|The user (?:wants|is asking|asked|needs)\b|Looking at the available tools\b|Let me (?:think|see which tool|check the tools|look at the tools)\b)/i
const TRAILING_COT =
  /\n+(?:Okay,\s+the user\b|The user (?:wants|is asking|asked|needs)\b|Looking at the available tools\b|Let me (?:think|see which tool|check the tools|look at the tools)\b)[\s\S]*$/i

export function stripOllamaThinking(text: string): string {
  if (!text) return text
  let out = text.replace(THINK_TAG, "").replace(THINKING_TAG, "")
  const clipped = out.replace(TRAILING_COT, "")
  if (clipped.trim().length > 0) out = clipped
  out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
  out = out.replace(/\s*Let me know if you need anything else!?\s*$/i, "").trim()
  if (!out || COT_OPEN.test(out)) return ""
  return out
}
