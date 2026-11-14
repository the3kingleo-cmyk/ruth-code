import { Plugin } from "@ruth/plugin/tui"
import { createMermaidCodeBlockRenderer } from "./markdown.js"
import { resolveRuthDiagramPalette } from "./palette.js"

export default Plugin.define({
  id: "ruth.merman",
  setup(context) {
    context.markdown.registerCodeBlockRenderer(
      "mermaid",
      createMermaidCodeBlockRenderer(context.renderer, () => ({
        colors: resolveRuthDiagramPalette(context.theme, context.themeMode),
      })),
    )
  },
})
