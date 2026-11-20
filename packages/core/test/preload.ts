import fs from "fs"
import os from "os"
import path from "path"

process.env.RUTH_DB = ":memory:"
process.env.NPM_CONFIG_AUDIT = "false"

// Every test run gets its own home, so no test reads or writes the developer's real config, data or credentials.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "ruth-core-home-"))
fs.mkdirSync(path.join(home, "tmp"), { recursive: true })
process.env.RUTH_TEST_HOME = home
process.env.HOME = home
process.env.USERPROFILE = home
process.env.TMPDIR = path.join(home, "tmp")
process.env.XDG_CONFIG_HOME = path.join(home, ".config")
process.env.XDG_DATA_HOME = path.join(home, ".local", "share")
process.env.XDG_CACHE_HOME = path.join(home, ".cache")
process.env.XDG_STATE_HOME = path.join(home, ".local", "state")
process.env.RUTH_CONFIG_DIR = path.join(home, ".config", "ruth")
// Bun resolves the home directory once at startup, so point os.homedir at the test home too.
os.homedir = () => home
for (const key of [
  "RUTH_CONFIG",
  "RUTH_CONFIG_CONTENT",
  "AWS_REGION",
  "GOOGLE_VERTEX_PROJECT",
  "NPM_CONFIG_REGISTRY",
  "UIDOTSH_AUTHORIZATION",
])
  delete process.env[key]
if (process.env.RECORD !== "true") delete process.env.OPENAI_API_KEY
process.on("exit", () => fs.rmSync(home, { recursive: true, force: true }))
