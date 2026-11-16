import { expect, test } from "bun:test"
import { PortOwner } from "../src/services/port-owner"

test("isManagedService recognizes ruth and opencode binaries only", () => {
  expect(PortOwner.isManagedService("/home/david/.local/bin/ruth serve --service")).toBe(true)
  expect(PortOwner.isManagedService("/home/david/.local/bin/Ruth serve --service")).toBe(true)
  expect(PortOwner.isManagedService("/usr/bin/opencode serve --service")).toBe(true)
  expect(PortOwner.isManagedService("jcode serve --service")).toBe(true)
  expect(PortOwner.isManagedService("bun packages/cli/src/index.ts serve --service")).toBe(false)
  expect(PortOwner.isManagedService("grep ruth service")).toBe(false)
  expect(PortOwner.isManagedService("/home/david/ruthless serve")).toBe(false)
})
