import { OllamaPlugin } from "./provider/ollama.js"
import type { PluginInternal } from "./internal.js"

/** Ruth ships with the local Ollama provider only. Cloud and other local-server plugins stay in the tree but are not loaded. */
export const ProviderPlugins: PluginInternal.InternalPlugin[] = [OllamaPlugin]
