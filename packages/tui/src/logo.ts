// RUTH wordmark. Drawn only with the original OpenCode logo's visible
// foreground glyphs (█ ▀ ▄) and spaces. Do not use _ ^ ~ , — those become
// background or shadow cells and disappear in some terminals (Crostini).
export const logo = {
  left: ["                   ", "█▀▀█ █▀▀█          ", "█▀▀▄ █  █          ", "█▄▄▀ ▀▀▀▀          "],
  right: ["                   ", "█▀▀█ █  █          ", "▄█▄  █▀▀█          ", "▀▀▀▀ ▀  ▀          "],
}

export const go = {
  left: ["    ", "█▀▀█", "█▀▀▄", "█▄▄▀"],
  right: ["    ", "█▀▀█", "▄█▄ ", "▀▀▀▀"],
}
