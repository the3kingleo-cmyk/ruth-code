export const available = Boolean(process.env.RUTH_PTY_BIN)

export async function resolveBinary() {
  return process.env.RUTH_PTY_BIN || "ruth-pty"
}
