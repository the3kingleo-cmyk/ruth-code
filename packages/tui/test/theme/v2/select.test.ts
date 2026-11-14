import { expect, test } from "bun:test"
import { selectTheme, selectThemeMode, supportsThemeMode, themeModes } from "@ruth/theme/tui"
import { getRuthTheme } from "../../../src/theme"

test("selects complete light and dark themes independently", () => {
  const light = selectTheme(getRuthTheme(), "light")
  const dark = selectTheme(getRuthTheme(), "dark")
  expect(selectTheme(getRuthTheme())).toEqual(light)
  expect(light.hue).toEqual(getRuthTheme().light.hue)
  expect(dark.text).toEqual(getRuthTheme().base.text)
  expect(dark.hue).toEqual(getRuthTheme().dark.hue)
  expect(selectThemeMode(getRuthTheme(), "dark")).toEqual({ theme: dark, mode: "dark" })
})

test("selects the available mode when the requested mode is missing", () => {
  const lightOnly = { base: getRuthTheme().base, light: getRuthTheme().light } as const
  const darkOnly = { base: getRuthTheme().base, dark: getRuthTheme().dark } as const

  expect(themeModes(lightOnly)).toEqual(["light"])
  expect(themeModes(darkOnly)).toEqual(["dark"])
  expect(supportsThemeMode(lightOnly, "light")).toBeTrue()
  expect(supportsThemeMode(lightOnly, "dark")).toBeFalse()
  expect(selectThemeMode(lightOnly, "dark")).toEqual({ theme: selectTheme(getRuthTheme(), "light"), mode: "light" })
  expect(selectThemeMode(darkOnly, "light")).toEqual({ theme: selectTheme(getRuthTheme(), "dark"), mode: "dark" })
})
