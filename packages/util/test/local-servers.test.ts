import { afterAll, describe, expect, test } from "bun:test"
import { normalizeServerURL, probeServer } from "../src/local-servers.js"

const servers: ReturnType<typeof Bun.serve>[] = []
const serve = (routes: Record<string, unknown>) => {
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const body = routes[new URL(request.url).pathname]
      return body === undefined ? new Response("not found", { status: 404 }) : Response.json(body)
    },
  })
  servers.push(server)
  return server.url.origin
}
afterAll(() => servers.forEach((server) => server.stop(true)))

describe("local servers", () => {
  test("normalizes the ways people write a server address", () => {
    expect(normalizeServerURL("localhost:1234")).toBe("http://localhost:1234")
    expect(normalizeServerURL("http://127.0.0.1:11434/v1/")).toBe("http://127.0.0.1:11434")
    expect(normalizeServerURL("http://box:11434/api")).toBe("http://box:11434")
    expect(normalizeServerURL("https://gpu.example/llm/v1/chat/completions")).toBe("https://gpu.example/llm")
  })

  test("recognizes each server kind and lists its models", async () => {
    const ollama = serve({ "/api/tags": { models: [{ name: "ruth:latest", model: "ruth:latest" }, { model: "llama3.2:3b" }] } })
    expect(await probeServer(ollama)).toEqual({
      kind: "ollama",
      name: "Ollama",
      baseURL: `${ollama}/v1`,
      models: ["llama3.2:3b", "ruth"],
    })
    const llama = serve({ "/v1/models": { data: [{ id: "gemma.gguf", owned_by: "llamacpp" }] } })
    expect((await probeServer(llama))?.kind).toBe("llama.cpp")
    const vllm = serve({ "/v1/models": { data: [{ id: "Qwen/Qwen3-8B", owned_by: "vllm" }] } })
    expect((await probeServer(vllm))?.kind).toBe("vllm")
    const lmstudio = serve({ "/v1/models": { data: [{ id: "qwen3-4b" }] }, "/api/v0/models": { data: [] } })
    expect((await probeServer(lmstudio))?.kind).toBe("lmstudio")
    const other = serve({ "/v1/models": { data: [{ id: "mistral" }] } })
    expect(await probeServer(`${other}/v1`)).toMatchObject({ kind: "local", baseURL: `${other}/v1`, models: ["mistral"] })
  })

  test("returns undefined when nothing answers", async () => {
    expect(await probeServer("http://127.0.0.1:9", { timeoutMs: 300 })).toBeUndefined()
    expect(await probeServer(serve({}))).toBeUndefined()
  })
})
