import { describe, expect, it } from "vitest";
import { ENV, getDocumentAiConfig } from "./env";

describe("getDocumentAiConfig", () => {
  it("disables Document AI when not configured", () => {
    const config = getDocumentAiConfig();
    expect(config.enabled).toBe(ENV.enableDocAi);
    expect(config.ready).toBe(false);
    expect(config.missing.length).toBeGreaterThan(0);
  });
});
