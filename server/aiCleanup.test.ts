import { beforeEach, describe, expect, it, vi } from "vitest";

import { sampleCanonicalTransactions } from "../fixtures/transactions";

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

vi.mock("./_core/log", () => ({
  logEvent: vi.fn(),
}));

import { cleanTransactions } from "./aiCleanup";
import { invokeLLM } from "./_core/llm";
import { logEvent } from "./_core/log";

const invokeMock = invokeLLM as unknown as vi.Mock;
const logEventMock = logEvent as unknown as vi.Mock;

describe("cleanTransactions (LLM response validation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back when LLM returns valid JSON but wrong shape ({})", async () => {
    invokeMock.mockResolvedValue({
      id: "test",
      created: 0,
      model: "test",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "{}" },
          finish_reason: "stop",
        },
      ],
    });

    const result = await cleanTransactions(sampleCanonicalTransactions);
    expect(result.cleaned).toHaveLength(sampleCanonicalTransactions.length);
    expect(result.removed).toHaveLength(0);
    expect(result.flagged).toHaveLength(0);
  });

  it('falls back when arrays are not arrays (e.g., {"cleaned": null})', async () => {
    invokeMock.mockResolvedValue({
      id: "test",
      created: 0,
      model: "test",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "{\"cleaned\":null,\"removed\":[],\"flagged\":[]}" },
          finish_reason: "stop",
        },
      ],
    });

    const result = await cleanTransactions(sampleCanonicalTransactions);
    expect(result.cleaned).toHaveLength(sampleCanonicalTransactions.length);
    expect(result.removed).toHaveLength(0);
    expect(result.flagged).toHaveLength(0);
  });

  it("accepts properly shaped results", async () => {
    invokeMock.mockResolvedValue({
      id: "test",
      created: 0,
      model: "test",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "{\"cleaned\":[],\"removed\":[],\"flagged\":[]}" },
          finish_reason: "stop",
        },
      ],
    });

    const result = await cleanTransactions(sampleCanonicalTransactions);
    expect(result.cleaned).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.flagged).toHaveLength(0);
  });

  it("logs parse fallback usage when LLM returns malformed JSON", async () => {
    invokeMock.mockResolvedValue({
      id: "test",
      created: 0,
      model: "test",
      choices: [
        {
          index: 0,
          // Not valid JSON -> triggers parse fallback
          message: { role: "assistant", content: "{not-json}" },
          finish_reason: "stop",
        },
      ],
    });

    await cleanTransactions(sampleCanonicalTransactions);

    const calls = logEventMock.mock.calls.filter(
      (c: any[]) => c[0] === "ai_cleanup_complete"
    );
    expect(calls.length).toBe(1);
    const completePayload = calls[0][1];
    expect(completePayload.usedFallback).toBe(true);
    expect(completePayload.fallbackReason).toBe("parse_error");
  });
});

