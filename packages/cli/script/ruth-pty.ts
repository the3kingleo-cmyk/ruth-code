import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"

export type RuthPtyAsset = {
  readonly source: string
  readonly version: string
  readonly sha256: string
}

type Target = {
  readonly platform: string
  readonly arch: string
  readonly libc?: "glibc" | "musl"
}

/** The persistent-PTY daemon to embed: only a local build named by RUTH_PTY_BIN, for the current platform. */
export async function resolveRuthPty(target: Target): Promise<RuthPtyAsset | undefined> {
  const local = process.env.RUTH_PTY_BIN
  if (!local) return undefined
  if (target.platform !== process.platform || target.arch !== process.arch)
    throw new Error("RUTH_PTY_BIN can only be embedded in a build for the current platform and architecture")
  const source = path.resolve(local)
  return {
    source,
    version: "local",
    sha256: createHash("sha256")
      .update(await readFile(source))
      .digest("hex"),
  }
}
