import { onMount } from "solid-js"
import { useToast } from "../ui/toast"

const MESSAGE = "Ollama not running — run: ruth doctor --repair"

async function reachable(origin: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/api/tags`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

/** Show a home-screen toast when no local or tunneled Ollama answers, without blocking the TUI. */
export function OllamaStatusToast() {
  const toast = useToast()

  onMount(() => {
    void (async () => {
      if (await reachable("http://127.0.0.1:11434")) return
      if (await reachable("http://127.0.0.1:11435")) return
      toast.show({
        variant: "warning",
        message: MESSAGE,
        duration: 20000,
      })
    })()
  })

  return null
}
