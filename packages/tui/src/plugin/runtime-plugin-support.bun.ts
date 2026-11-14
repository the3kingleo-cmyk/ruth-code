import { ensurePluginRuntime, provides } from "@ruth/plugin/runtime"
import { Plugin, PluginContextProvider, usePlugin } from "@ruth/plugin/tui"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"

ensurePluginRuntime()
ensureRuntimePluginSupport({
  additional: {
    "@ruth/plugin/tui": { Plugin, PluginContextProvider, usePlugin },
  },
  preserve: provides,
})
