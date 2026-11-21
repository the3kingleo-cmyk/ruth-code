import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { ensureDefaultConfig, findExistingConfig, upgradeRuthConfigFile } from "../src/defaults"

describe("ensureDefaultConfig", () => {
  test("creates ruth.json once and leaves an existing file alone", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ruth-config-"))
    const first = ensureDefaultConfig({ directory })
    expect(first.created).toBe(true)
    const body = fs.readFileSync(first.path, "utf8")
    expect(body).toContain("ollama/ruth")
    expect(body).toContain('"ruth": {')
    expect(body).not.toContain("huihui_ai/qwen3-abliterated")
    expect(body.split('"models"')[1]).not.toContain("ruth-pro")
    const second = ensureDefaultConfig({ directory })
    expect(second.created).toBe(false)
    expect(second.path).toBe(first.path)
    expect(findExistingConfig(directory)).toBe(first.path)
    const cfg = JSON.parse(body)
    expect(cfg.mcp.servers.browse.command[1]).toBe("mcp")
    expect(cfg.mcp.servers.browse.codemode).toBe(false)
    expect(cfg.mcp.servers.browse.environment.OPENCODE_BROWSER_AUTO_UPDATE).toBe("off")
    expect(cfg.permissions).toEqual(expect.arrayContaining([
      { action: "*", resource: "*", effect: "allow" },
      { action: "external_directory", resource: "*", effect: "allow" },
      { action: "doom_loop", resource: "*", effect: "allow" },
    ]))
    expect(cfg.permissions.every((rule: { effect: string }) => rule.effect !== "ask")).toBe(true)
    fs.rmSync(directory, { recursive: true, force: true })
  })

  test("upgrades an older config: allow leftover asks and register browse", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ruth-config-"))
    const file = path.join(directory, "ruth.json")
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          model: "ollama/ruth",
          permissions: [
            { action: "bash", resource: "*", effect: "ask" },
            { action: "webfetch", resource: "*", effect: "deny" },
          ],
        },
        null,
        2,
      ) + "\n",
    )
    expect(upgradeRuthConfigFile(file)).toBe(true)
    const cfg = JSON.parse(fs.readFileSync(file, "utf8"))
    expect(cfg.permissions).toEqual([
      { action: "bash", resource: "*", effect: "allow" },
      { action: "webfetch", resource: "*", effect: "deny" },
      { action: "*", resource: "*", effect: "allow" },
    ])
    expect(cfg.mcp.servers.browse.command.at(-1)).toBe("mcp")
    expect(upgradeRuthConfigFile(file)).toBe(false)
    fs.rmSync(directory, { recursive: true, force: true })
  })
})
