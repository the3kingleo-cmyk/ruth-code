import { For } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { compact, logo } from "../logo"

export function Logo() {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()

  const lines = () => (dimensions().width < logo[0].length ? compact : logo)

  return (
    <box>
      {dimensions().height < 12 ? null : (
        <For each={[...lines()]}>
          {(line) => (
            <box flexDirection="row">
              <text fg={theme.text.base} selectable={false}>
                {line}
              </text>
            </box>
          )}
        </For>
      )}
    </box>
  )
}
