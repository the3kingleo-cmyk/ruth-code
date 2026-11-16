import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { parseRepoSpec, resolveLaunchDirectory } from "../src/project-dir"

describe("parseRepoSpec", () => {
  test("treats a bare name as the3kingleo-cmyk/<name>", () => {
    expect(parseRepoSpec("ruth-code")).toEqual({ owner: "the3kingleo-cmyk", repo: "ruth-code" })
  })
  test("accepts owner/repo and GitHub URLs", () => {
    expect(parseRepoSpec("acme/tools")).toEqual({ owner: "acme", repo: "tools" })
    expect(parseRepoSpec("https://github.com/acme/tools.git")).toEqual({ owner: "acme", repo: "tools" })
  })
  test("ignores ordinary paths", () => {
    expect(parseRepoSpec("/tmp/project")).toBeUndefined()
    expect(parseRepoSpec("../other")).toBeUndefined()
  })
})

describe("resolveLaunchDirectory", () => {
  test("defaults to $HOME when launched from home or ~", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ruth-home-"))
    process.env.RUTH_TEST_HOME = home
    process.env.RUTH_PROJECTS_DIR = path.join(home, "src")
    expect(resolveLaunchDirectory(undefined, { cwd: home }).directory).toBe(home)
    expect(resolveLaunchDirectory("~", { cwd: "/tmp" }).directory).toBe(home)
    delete process.env.RUTH_TEST_HOME
    delete process.env.RUTH_PROJECTS_DIR
    fs.rmSync(home, { recursive: true, force: true })
  })

  test("clones a missing the3kingleo-cmyk repo on demand into ~/src", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ruth-home-"))
    process.env.RUTH_TEST_HOME = home
    process.env.RUTH_PROJECTS_DIR = path.join(home, "src")
    const clones: string[] = []
    const result = resolveLaunchDirectory("ruth-code", {
      cwd: home,
      clone: ({ dest, owner, repo }) => {
        clones.push(`${owner}/${repo}`)
        fs.mkdirSync(path.join(dest, ".git"), { recursive: true })
      },
    })
    expect(clones).toEqual(["the3kingleo-cmyk/ruth-code"])
    expect(result.cloned).toBe(true)
    expect(result.directory).toBe(path.join(home, "src", "the3kingleo-cmyk", "ruth-code"))
    delete process.env.RUTH_TEST_HOME
    delete process.env.RUTH_PROJECTS_DIR
    fs.rmSync(home, { recursive: true, force: true })
  })
})
