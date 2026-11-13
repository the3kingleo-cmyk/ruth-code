import { describe, expect, test } from "bun:test"
import { parseSha256, pickLinuxX64Asset } from "../src/github-release"

describe("github release helpers", () => {
  test("picks the linux-x64 archive and checksum", () => {
    const picked = pickLinuxX64Asset({
      tag: "v1.0.0",
      name: "Ruth",
      assets: [
        { name: "notes.txt", url: "https://example.com/notes" },
        { name: "ruth-linux-x64.tar.gz", url: "https://example.com/bin", digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        { name: "ruth-linux-x64.tar.gz.sha256", url: "https://example.com/sum" },
      ],
    })
    expect(picked.binary?.name).toBe("ruth-linux-x64.tar.gz")
    expect(picked.checksum?.name).toBe("ruth-linux-x64.tar.gz.sha256")
    expect(parseSha256(picked.binary!.digest!)).toHaveLength(64)
  })
})
