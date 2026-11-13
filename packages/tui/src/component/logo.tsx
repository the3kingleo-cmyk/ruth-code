import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"

/** Home-screen wordmark: plain lowercase "ruth" in the terminal's normal font. */
export function Logo() {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()

  return (
    <box>
      {dimensions().height < 12 ? null : (
        <text fg={theme.text.base} attributes={TextAttributes.BOLD} selectable={false}>
          ruth
        </text>
      )}
    </box>
  )
}
