// RUTH wordmark for terminals that cannot show half-blocks or muted/shadow colors
// (Crostini / Noto Sans Mono / hterm). Rules:
// - only the full block █ and space (no ▀ ▄, no _ ^ ~ ,)
// - at least one empty column between letters
// - a single foreground color is applied by the renderer (theme text, never muted/bg)
export const logo = [
  "████   █   █  █████  █   █",
  "█   █  █   █    █    █   █",
  "████   █   █    █    █████",
  "█  █   █   █    █    █   █",
  "█   █  █████    █    █   █",
] as const

/** Narrow-terminal wordmark: 3-column letters, still █ and space only. */
export const compact = [
  "███ █ █ ███ █ █",
  "█ █ █ █  █  █ █",
  "██  █ █  █  ███",
  "█ █ █ █  █  █ █",
  "█ █ ███  █  █ █",
] as const

/** Small solid R used by the mini splash and Go upsell mark. */
export const mark = ["███", "█ █", "██ ", "█ █", "█ █"] as const

/** Split form kept for splash / Go upsell callers; same █-only glyph set. */
export const go = {
  left: [...mark],
  right: [...mark],
}
