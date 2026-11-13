import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const execFileP = promisify(execFile)

export const PICTURES_DIR = () => path.join(os.homedir(), "Pictures", "ruth")

export async function ensurePicturesDir() {
  const dir = PICTURES_DIR()
  await fs.mkdir(dir, { recursive: true })
  return dir
}

export function timestampedPath(prefix: string, ext: string, now = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0")
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  return path.join(PICTURES_DIR(), `${prefix}-${stamp}${ext}`)
}

export async function which(command: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileP("sh", ["-c", 'command -v "$1"', "sh", command], { timeout: 5_000 })
    const found = stdout.trim()
    return found || undefined
  } catch {
    return undefined
  }
}

export async function run(command: string, args: string[], opts?: { timeout?: number; env?: NodeJS.ProcessEnv }) {
  const { stdout, stderr } = await execFileP(command, args, {
    timeout: opts?.timeout ?? 20_000,
    env: { ...process.env, ...(opts?.env ?? {}) },
    maxBuffer: 2 * 1024 * 1024,
  })
  return { stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "" }
}

export async function fileReady(file: string) {
  const stat = await fs.stat(file)
  if (!stat.isFile() || stat.size <= 0) throw new Error(`Capture produced an empty file: ${file}`)
  return file
}
