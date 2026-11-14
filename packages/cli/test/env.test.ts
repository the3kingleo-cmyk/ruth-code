import { expect, test } from "bun:test"
import { Env } from "../src/env"

test("session environment omits server credentials", () => {
  const previousPassword = process.env.RUTH_PASSWORD
  const previousLegacyPassword = process.env.RUTH_SERVER_PASSWORD
  const previousValue = process.env.RUTH_SESSION_ENV_TEST
  process.env.RUTH_PASSWORD = "password"
  process.env.RUTH_SERVER_PASSWORD = "legacy"
  process.env.RUTH_SESSION_ENV_TEST = "included"

  const environment = Env.session()

  if (previousPassword === undefined) delete process.env.RUTH_PASSWORD
  else process.env.RUTH_PASSWORD = previousPassword
  if (previousLegacyPassword === undefined) delete process.env.RUTH_SERVER_PASSWORD
  else process.env.RUTH_SERVER_PASSWORD = previousLegacyPassword
  if (previousValue === undefined) delete process.env.RUTH_SESSION_ENV_TEST
  else process.env.RUTH_SESSION_ENV_TEST = previousValue

  expect(environment.RUTH_PASSWORD).toBeUndefined()
  expect(environment.RUTH_SERVER_PASSWORD).toBeUndefined()
  expect(environment.RUTH_SESSION_ENV_TEST).toBe("included")
})
