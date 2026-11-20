import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { parseRepoSpec, resolveLaunchDirectory } from "../src/project-dir"

describe("parseRepoSpec", () => {
  test("does not treat a bare name as a repo without an owner", () => {
    expect(parseRepoSpec("ruth-code")).toBeUndefined()
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

  test("clones an explicit owner/repo on demand into ~/src", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ruth-home-"))
    process.env.RUTH_TEST_HOME = home
    process.env.RUTH_PROJECTS_DIR = path.join(home, "src")
    const clones: string[] = []
    const result = resolveLaunchDirectory("acme/tools", {
      cwd: home,
      clone: ({ dest, owner, repo }) => {
        clones.push(`${owner}/${repo}`)
        fs.mkdirSync(path.join(dest, ".git"), { recursive: true })
      },
    })
    expect(clones).toEqual(["acme/tools"])
    expect(result.cloned).toBe(true)
    expect(result.directory).toBe(path.join(home, "src", "acme", "tools"))
    delete process.env.RUTH_TEST_HOME
    delete process.env.RUTH_PROJECTS_DIR
    fs.rmSync(home, { recursive: true, force: true })
  })
})
