export const available = true

export async function resolveBinary() {
  return process.env.RUTH_PTY_BIN || "ruth-pty"
}
