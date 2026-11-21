import { afterEach, expect, test } from "bun:test"
import {
  chooseRuthNumCtx,
  estimateRequestTokens,
  isFreshRuthChat,
  nextRuthNumCtx,
  resetRuthNumCtxFloor,
  RUTH_CTX_DEFAULT,
  RUTH_CTX_MAX,
  RUTH_NUM_CTX,
} from "./ruth-ctx"

afterEach(() => resetRuthNumCtxFloor())

test("catalog window is 20K and the Modelfile default is 16K", () => {
  expect(RUTH_NUM_CTX).toBe(20_480)
  expect(RUTH_CTX_MAX).toBe(20_480)
  expect(RUTH_CTX_DEFAULT).toBe(16_384)
})

test("picks the smallest bucket that fits the prompt plus reserve", () => {
  expect(chooseRuthNumCtx(100)).toBe(8192)
  expect(chooseRuthNumCtx(7000)).toBe(12_288)
  expect(chooseRuthNumCtx(11_000)).toBe(16_384)
  expect(chooseRuthNumCtx(15_000)).toBe(20_480)
  expect(chooseRuthNumCtx(30_000)).toBe(20_480)
})

test("never shrinks below a session floor", () => {
  expect(chooseRuthNumCtx(100, { floor: 16_384 })).toBe(16_384)
})

test("treats a single user message as a fresh chat", () => {
  expect(isFreshRuthChat([{ role: "system", content: "hi" }, { role: "user", content: "hello" }])).toBe(true)
  expect(
    isFreshRuthChat([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "again" },
    ]),
  ).toBe(false)
})

test("grows mid-conversation and may shrink on a fresh short chat", () => {
  const long = "x".repeat(50_000)
  expect(nextRuthNumCtx({ messages: [{ role: "user", content: long }] })).toBe(16_384)
  expect(
    nextRuthNumCtx({
      messages: [
        { role: "user", content: long },
        { role: "assistant", content: "ok" },
        { role: "user", content: "and then?" },
      ],
    }),
  ).toBe(16_384)
  expect(nextRuthNumCtx({ messages: [{ role: "user", content: "hi" }] })).toBe(8192)
})

test("counts tools and message text in the estimate", () => {
  const tokens = estimateRequestTokens({
    messages: [{ role: "user", content: "abcd" }],
    tools: [{ type: "function", function: { name: "bash", parameters: { type: "object" } } }],
  })
  expect(tokens).toBeGreaterThan(1)
})
