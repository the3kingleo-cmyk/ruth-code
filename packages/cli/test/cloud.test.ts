import { describe, expect, test } from "bun:test"
import {
  DEFAULT_CLOUD_MACHINE,
  DEFAULT_CLOUD_REPO,
  estimateSessionHours,
  formatCloudStatus,
  isScopeError,
  missingScopeMessage,
  parseCodespaceList,
  pickExistingCodespace,
} from "../src/cloud"
import { formCancelFailsRun } from "../src/run/noninteractive"

describe("ruth cloud helpers", () => {
  test("detects missing Codespaces scopes", () => {
    expect(isScopeError("Resource not accessible by personal access token", 403)).toBe(true)
    expect(isScopeError("This API operation needs the 'codespace' scope", 401)).toBe(true)
    expect(isScopeError("ok", 200)).toBe(false)
    expect(missingScopeMessage()).toContain("codespace")
    expect(missingScopeMessage()).toContain("the3kingleo-cmyk/ruth-codespace")
  })

  test("reuses a running codespace with the Ruth display name", () => {
    const list = parseCodespaceList(
      JSON.stringify([
        { name: "other-1", state: "Available", displayName: "scratch", repository: DEFAULT_CLOUD_REPO },
        { name: "ruth-ollama-abc", state: "Shutdown", displayName: "ruth-ollama", repository: DEFAULT_CLOUD_REPO },
        { name: "ruth-ollama-run", state: "Available", displayName: "ruth-ollama", repository: DEFAULT_CLOUD_REPO },
      ]),
    )
    const picked = pickExistingCodespace(list, { repo: DEFAULT_CLOUD_REPO, displayName: "ruth-ollama" })
    expect(picked?.name).toBe("ruth-ollama-run")
  })

  test("estimates session hours against the 120 core-hour personal allowance", () => {
    const started = new Date("2026-11-13T10:00:00-08:00")
    const now = new Date("2026-11-13T12:30:00-08:00")
    const estimate = estimateSessionHours(started.toISOString(), now, 4)
    expect(estimate.sessionHours).toBe(2.5)
    expect(estimate.sessionCoreHours).toBe(10)
    expect(estimate.note).toContain("120")
    expect(estimate.note).toContain("30")
    expect(DEFAULT_CLOUD_MACHINE).toBe("standardLinux32gb")
  })

  test("status text mentions the preferred origin", () => {
    const text = formatCloudStatus({
      ghInstalled: true,
      auth: { ok: true, detail: "ok", missingScope: false },
      tunnel: { ok: false, detail: "No cloud tunnel is recorded. Run: ruth cloud up" },
      origin: "http://127.0.0.1:11434",
      preferred: "local",
      hours: estimateSessionHours(undefined),
      detail: "local",
    })
    expect(text).toContain("origin: http://127.0.0.1:11434 (local)")
    expect(text).toContain("120")
  })
})

describe("noninteractive form cancel", () => {
  test("does not fail ruth run when a web search provider prompt is cancelled", () => {
    expect(formCancelFailsRun({ metadata: { kind: "websearch.provider" }, title: "Web Search" })).toBe(false)
    expect(formCancelFailsRun({ metadata: { kind: "question" }, title: "Question" })).toBe(false)
    expect(formCancelFailsRun({ metadata: { kind: "mcp.elicitation" }, title: "Secret" })).toBe(true)
  })
})
