import { describe, expect, test } from "bun:test"
import {
  AuthenticationError,
  ContentPolicyError,
  InvalidProviderOutputError,
  InvalidRequestError,
  UnsupportedOperationError,
  AIError,
  ProviderID,
  ProviderInternalError,
  QuotaExceededError,
  RateLimitError,
  TransportError,
  UnknownProviderError,
  ToolFailure,
  HttpContext,
} from "@ruth/ai/effect"
import { RequestExecutor } from "@ruth/ai/route"
import { Permission } from "@ruth/core/permission"
import { ID } from "@ruth/core/model"
import { ModelResolver } from "@ruth/core/model-resolver"
import { Provider } from "@ruth/core/provider"
import { Tool } from "@ruth/schema/tool"
import { toSessionError } from "@ruth/core/session/to-session-error"
import { ModelRetry } from "@ruth/core/model-retry"
import { Effect } from "effect"
import { SessionRunnerRetry } from "@ruth/core/session/runner/retry"

const llm = (reason: AIError["reason"]) => new AIError({ reason })

describe("toSessionError", () => {
  test("maps every AI error reason to the open wire type", () => {
    expect(toSessionError(llm(new RateLimitError({ message: "rate", retryAfterMs: 123 })))).toEqual({
      type: "provider.rate-limit",
      message: "rate",
      retryAfterMs: 123,
    })
    expect(toSessionError(llm(new AuthenticationError({ message: "auth" }))).type).toBe("provider.auth")
    expect(toSessionError(llm(new QuotaExceededError({ message: "quota", retryAfterMs: 456 })))).toEqual({
      type: "provider.quota",
      message: "quota",
      retryAfterMs: 456,
    })
    expect(toSessionError(llm(new ContentPolicyError({ message: "blocked" }))).type).toBe("provider.content-filter")
    expect(
      toSessionError(llm(new TransportError({ message: "transport", transport: "http", operation: "request" }))).type,
    ).toBe("provider.transport")
    expect(toSessionError(llm(new ProviderInternalError({ message: "internal", retryAfterMs: 789 })))).toEqual({
      type: "provider.internal",
      message: "internal",
      retryAfterMs: 789,
    })
    expect(toSessionError(llm(new InvalidProviderOutputError({ message: "output" }))).type).toBe(
      "provider.invalid-output",
    )
    expect(toSessionError(llm(new InvalidRequestError({ message: "request" }))).type).toBe("provider.invalid-request")
    expect(
      toSessionError(
        llm(
          new UnsupportedOperationError({
            message: "no compact endpoint",
            operation: "compact",
            provider: ProviderID.make("provider"),
            route: "route",
          }),
        ),
      ),
    ).toEqual({ type: "provider.unsupported-operation", message: "no compact endpoint" })
    expect(toSessionError(llm(new UnknownProviderError({ message: "unknown" }))).type).toBe("provider.unknown")
  })

  test("separates paid rate limits, credit limits, and other providers' 429s", () => {
    const fail = (url: string, body: unknown, headers?: Record<string, string>) =>
      RequestExecutor.httpFailure({
        message: "Rate limit exceeded. Please try again later.",
        url,
        status: 429,
        responseHeaders: headers,
        responseBody: JSON.stringify(body),
      })

    const paid = fail(
      "https://gateway.example.com/v1/chat/completions",
      { error: { type: "server_error", message: "Upstream request failed: Rate limit exceeded." } },
      { "retry-after": "45" },
    )
    expect(SessionRunnerRetry.isRetryable(paid)).toBe(true)
    expect(toSessionError(paid)).toMatchObject({ type: "provider.rate-limit", retryAfterMs: 45_000 })

    const credit = RequestExecutor.httpFailure({
      message: "Credit limit exceeded.",
      url: "https://gateway.example.com/v1/chat/completions",
      status: 402,
      responseBody: JSON.stringify({
        type: "error",
        error: { type: "CreditLimitExceeded", message: "Credit limit exceeded." },
      }),
    })
    expect(toSessionError(credit)).toMatchObject({ type: "provider.quota" })

    const other = fail(
      "https://api.openai.com/v1/chat/completions",
      { error: { type: "rate_limit_error", message: "Too many requests" } },
      { "retry-after": "10" },
    )
    expect(SessionRunnerRetry.isRetryable(other)).toBe(true)
    expect(toSessionError(other)).toMatchObject({ type: "provider.rate-limit", retryAfterMs: 10_000 })
  })

  test("types the ChatGPT usage limit whichever way the failure arrives", () => {
    const body = JSON.stringify({ error: { code: "subscription_sharing_usage_limit_exceeded", message: "Limit" } })
    for (const reason of [
      new RateLimitError({ message: "Too many requests", body }),
      new UnknownProviderError({ message: "Request failed", body }),
    ])
      expect(toSessionError(llm(reason))).toEqual({
        type: "provider.chatgpt-limit",
        message: "ChatGPT usage limit reached. Check ChatGPT Settings → Usage for details.",
        response: { body },
      })
  })

  test("preserves the permission rejection type without exposing internal fields", () => {
    const blocked = new Permission.BlockedError({ rules: [], permission: "external_directory", resources: [] })
    expect(toSessionError(blocked)).toEqual({
      type: "permission.rejected",
      message: "Permission denied: external_directory",
    })
    expect(toSessionError(new ToolFailure({ message: blocked.message, error: blocked }))).toEqual({
      type: "permission.rejected",
      message: "Permission denied: external_directory",
    })
    expect(toSessionError(new Tool.Error({ message: "failed" }))).toEqual({
      type: "tool.execution",
      message: "failed",
    })
  })

  test("preserves provider HTTP status without exposing runtime diagnostics", () => {
    const http = new HttpContext({
      url: "https://example.com",
      status: 413,
      headers: { "x-request-id": "request-1" },
    })
    expect(
      toSessionError(
        llm(
          new InvalidRequestError({
            message: "too large",
            classification: "context-overflow",
            parameter: "messages",
            body: '{"error":"context limit"}',
            http,
            cause: new Error("request failed"),
          }),
        ),
      ),
    ).toEqual({
      type: "provider.invalid-request",
      message: "too large",
      status: 413,
      response: { body: '{"error":"context limit"}' },
    })
    expect(
      toSessionError(
        llm(
          new ProviderInternalError({
            message: "bad gateway",
            http: new HttpContext({ url: "https://example.com", status: 502, headers: {} }),
          }),
        ),
      ),
    ).toEqual({
      type: "provider.internal",
      message: "bad gateway",
      status: 502,
    })
  })

  test("preserves provider response body without HTTP status", () => {
    expect(toSessionError(llm(new RateLimitError({ message: "Slow down", body: '{"error":"rate limit"}' })))).toEqual({
      type: "provider.rate-limit",
      message: "Slow down",
      response: { body: '{"error":"rate limit"}' },
    })
  })

  test("maps token-sharing failures while preserving HTTP and stream bodies", () => {
    const cases = [
      ["subscription_sharing_user_not_eligible", "token sharing isn't available for this account"],
      ["subscription_sharing_usage_limit_exceeded", "ChatGPT usage limit reached"],
      ["subscription_sharing_workplace_individual_usage_limit_exceeded", "workspace admin"],
      ["subscription_sharing_usage_unavailable", "Try again later"],
      ["subscription_sharing_unsupported_capability", "Remove the unsupported feature"],
      ["subscription_sharing_route_not_supported", "Check the configured endpoint"],
      ["subscription_sharing_invalid_user", "Reconnect to ChatGPT"],
      ["subscription_sharing_user_unavailable", "Try again later"],
      ["chatpass_v2_scope_not_authorized", "isn't authorized for this request"],
      ["chatpass_v2_invalid_authorization_context", "isn't authorized for this request"],
    ] as const
    for (const [code, guidance] of cases) {
      for (const body of [
        JSON.stringify({ error: { code, message: "Request failed" } }),
        JSON.stringify({ type: "response.failed", response: { error: { code, message: "Request failed" } } }),
      ]) {
        const error = toSessionError(llm(new UnknownProviderError({ message: "Request failed", body })))
        expect(error.message).toContain(guidance)
        expect(error.response).toEqual({ body })
      }
    }
  })

  test("preserves unresolved provider endpoint errors", () => {
    const error = new ModelResolver.UnresolvedProviderVariablesError({
      providerID: Provider.ID.make("cloudflare-workers-ai"),
      modelID: ID.make("model"),
      variables: ["CLOUDFLARE_ACCOUNT_ID"],
    })
    expect(toSessionError(error)).toEqual({
      type: "provider.no-route",
      message:
        "Cannot initialize cloudflare-workers-ai/model: CLOUDFLARE_ACCOUNT_ID is required to resolve the provider endpoint",
    })
  })

  test("preserves provider configuration and initialization errors", () => {
    const configuration = new ModelResolver.ModelConfigurationError({
      providerID: Provider.ID.make("azure"),
      modelID: ID.make("gpt-5.4-nano"),
      package: "@ruth/ai/providers/azure/responses",
      detail: "Azure requires resourceName or baseURL",
    })
    expect(toSessionError(configuration)).toEqual({
      type: "provider.no-route",
      message: "Cannot initialize azure/gpt-5.4-nano: Azure requires resourceName or baseURL",
    })
    const initialization = new ModelResolver.ModelInitializationError({
      providerID: Provider.ID.make("custom"),
      modelID: ID.make("model"),
      package: "@ruth/ai/providers/custom",
      phase: "load",
      detail: "Provider package @ruth/ai/providers/custom is broken",
    })
    expect(toSessionError(initialization)).toEqual({
      type: "provider.no-route",
      message: "Cannot initialize custom/model: Provider package @ruth/ai/providers/custom is broken",
    })
  })

  test("retries rate limits, provider-internal, transport, and unrecognized failures", () => {
    const eligible = [
      llm(new RateLimitError({ message: "rate" })),
      llm(new ProviderInternalError({ message: "internal" })),
      llm(new TransportError({ message: "transport", transport: "http", operation: "request" })),
      llm(new UnknownProviderError({ message: "unknown" })),
    ]
    const ineligible = [
      llm(new AuthenticationError({ message: "auth" })),
      llm(new QuotaExceededError({ message: "quota" })),
      llm(new ContentPolicyError({ message: "blocked" })),
      llm(new InvalidProviderOutputError({ message: "output" })),
      llm(new InvalidRequestError({ message: "request" })),
      llm(new UnsupportedOperationError({ message: "unsupported", operation: "compact" })),
    ]

    expect(eligible.map(SessionRunnerRetry.isRetryable)).toEqual([true, true, true, true])
    expect(ineligible.map(SessionRunnerRetry.isRetryable)).toEqual([false, false, false, false, false, false])
  })

  test("retries accepted transport reads but not accepted writes or rejected requests", () => {
    const retryable = [
      llm(new TransportError({ message: "http transport", transport: "http", operation: "request" })),
      llm(
        new TransportError({
          message: "connect failed",
          transport: "websocket",
          operation: "request",
          delivery: "not-sent",
          phase: "connect",
        }),
      ),
      llm(
        new TransportError({
          message: "send uncertain",
          transport: "websocket",
          operation: "write",
          delivery: "ambiguous",
          phase: "send",
        }),
      ),
      llm(
        new TransportError({
          message: "response interrupted",
          transport: "websocket",
          operation: "read",
          delivery: "accepted",
          phase: "receive",
        }),
      ),
    ]
    const ineligible = [
      llm(
        new TransportError({
          message: "accepted write failed",
          transport: "websocket",
          operation: "write",
          delivery: "accepted",
          phase: "send",
        }),
      ),
      llm(
        new TransportError({
          message: "continuation rejected",
          transport: "websocket",
          operation: "read",
          delivery: "rejected",
          recovery: "retry-full",
          phase: "receive",
        }),
      ),
    ]

    expect(retryable.map(SessionRunnerRetry.isRetryable)).toEqual([true, true, true, true])
    expect(ineligible.map(SessionRunnerRetry.isRetryable)).toEqual([false, false])
  })

  test("honors provider retry header overrides", () => {
    const http = (headers: Record<string, string>) =>
      new HttpContext({
        url: "https://example.com",
        status: 500,
        headers,
      })

    expect(
      SessionRunnerRetry.isRetryable(
        llm(
          new ProviderInternalError({
            message: "do not retry",
            http: http({ "x-should-retry": "false" }),
          }),
        ),
      ),
    ).toBeFalse()
    expect(
      SessionRunnerRetry.isRetryable(
        llm(new InvalidRequestError({ message: "retry", http: http({ "x-should-retry": "true" }) })),
      ),
    ).toBeTrue()
  })
})

describe("local model server down", () => {
  const refused = (url: string) =>
    llm(
      new TransportError({
        message: "Unable to connect",
        transport: "http",
        operation: "request",
        code: "ECONNREFUSED",
        url,
      }),
    )

  test("names the server and how to start it", () => {
    const error = toSessionError(refused("http://127.0.0.1:11434/v1/chat/completions"))
    expect(error.type).toBe("provider.transport")
    expect(error.message).toContain("Ollama isn't running at 127.0.0.1:11434")
    expect(error.message).toContain("ollama serve")
  })

  test("stops retrying a refused local connection after two quick attempts", async () => {
    const decisions = await Effect.runPromise(
      Effect.gen(function* () {
        const decide = yield* ModelRetry.policy
        const cause = refused("http://127.0.0.1:11434/v1/chat/completions")
        return [
          yield* decide({ cause, retry: true }),
          yield* decide({ cause, retry: true }),
          yield* decide({ cause, retry: true }),
        ]
      }),
    )
    expect(decisions.map((decision) => decision !== undefined)).toEqual([true, true, false])
    expect(ModelRetry.isLocalServerDown(refused("https://api.example.com/v1"))).toBe(false)
  })
})
