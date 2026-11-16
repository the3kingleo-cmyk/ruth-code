import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"

/** Home-screen mark: the same plain <text> method as the footer, no block art. */
export function Logo() {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const accent = () => theme.categorical[0]?.[400] ?? theme.text.feedback.info.base

  return (
    <box alignItems="center">
      {dimensions().height < 12 ? null : (
        <>
          <box flexDirection="row" gap={1}>
            <text fg={accent()} selectable={false}>
              ◆
            </text>
            <text fg={theme.text.base} attributes={TextAttributes.BOLD} selectable={false}>
              ruth
            </text>
          </box>
          <text fg={theme.text.muted} selectable={false}>
            your local AI
          </text>
        </>
      )}
    </box>
  )
}
