import { Plugin } from "@ruth/plugin/tui"

// A dialog that throws while rendering.
export default Plugin.define({
  id: "fixture.dialog-throw",
  setup(context) {
    context.ui.dialog.show(() => {
      throw new Error("dialog exploded")
    })
  },
})
