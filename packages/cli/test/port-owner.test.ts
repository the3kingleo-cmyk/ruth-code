import { expect, test } from "bun:test"
import { PortOwner } from "../src/services/port-owner"

test("isManagedService recognizes Ruth servers only", () => {
  expect(PortOwner.isManagedService("/home/david/.local/bin/ruth serve --service")).toBe(true)
  expect(PortOwner.isManagedService("/home/david/.local/bin/Ruth serve --service")).toBe(true)
  expect(PortOwner.isManagedService("/usr/bin/ruth serve --service")).toBe(true)
  expect(PortOwner.isManagedService("jcode serve --service")).toBe(true)
  expect(PortOwner.isManagedService("/usr/bin/bun /tmp/home/ruth.ts serve --service")).toBe(true)
  expect(PortOwner.isManagedService("bun /tmp/home/ruth.ts run hello")).toBe(false)
  expect(PortOwner.isManagedService("bun packages/cli/src/index.ts serve --service")).toBe(false)
  expect(PortOwner.isManagedService("grep ruth service")).toBe(false)
  expect(PortOwner.isManagedService("/home/david/ruthless serve")).toBe(false)
})

test("isServiceProcess recognizes background service launches", () => {
  expect(PortOwner.isServiceProcess("bun packages/cli/src/index.ts serve --service")).toBe(true)
  expect(PortOwner.isServiceProcess("bun test ./test/service.test.ts")).toBe(false)
})
