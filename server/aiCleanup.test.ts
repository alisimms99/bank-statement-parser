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

const invokeMock = invokeLLM as unknown as vi.Mock;

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
});

