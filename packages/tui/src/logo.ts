// Lowercase "ruth" wordmark. Only full block █ and space (no ▀ ▄, no _ ^ ~ ,).
// One foreground color is applied by the renderer (theme text, never muted/bg).
// 4-column letters, 2-column gaps (width 22, even) so margins stay equal in the
// 76-column prompt column. The suggested r ear (█ ██) is joined on the next
// row (███) so it does not float disconnected from the stem.
export const logo = [
  "             █    █   ",
  "█ ██  █  █  ███   █   ",
  "███   █  █   █    ███ ",
  "█     █  █   █    █  █",
  "█      ███    ██  █  █",
] as const

/** Narrow-terminal wordmark: same letters, 1-column gaps. */
export const compact = [
  "           █   █   ",
  "█ ██ █  █ ███  █   ",
  "███  █  █  █   ███ ",
  "█    █  █  █   █  █",
  "█     ███   ██ █  █",
] as const

/** Small solid r used by the mini splash and Go upsell mark. */
export const mark = [
  "█ ██",
  "███ ",
  "█   ",
  "█   ",
] as const

/** Split form kept for splash / Go upsell callers; same █-only glyph set. */
export const go = {
  left: [...mark],
  right: [...mark],
}
