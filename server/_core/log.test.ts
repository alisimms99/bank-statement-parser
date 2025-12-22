import { describe, it, expect, vi, beforeEach } from "vitest";
import { logError, logIngestionError, logInfo, logIngestionSuccess } from "./log";

describe("Structured Logging", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("should output JSON format for info logs", () => {
    logInfo("test message", { key: "value" });

    expect(console.log).toHaveBeenCalled();
    const output = (console.log as any).mock.calls[0][0];
    const parsed = JSON.parse(output);

    expect(parsed.severity).toBe("INFO");
    expect(parsed.message).toBe("test message");
    expect(parsed.metadata.key).toBe("value");
    expect(parsed.timestamp).toBeDefined();
  });

  it("should include error reporting type for errors", () => {
    const error = new Error("test error");
    logError("Something failed", error, { exportId: "test-123" });

    expect(console.error).toHaveBeenCalled();
    const output = (console.error as any).mock.calls[0][0];
    const parsed = JSON.parse(output);

    expect(parsed["@type"]).toContain("clouderrorreporting");
    expect(parsed.stack).toBeDefined();
    expect(parsed.exportId).toBe("test-123");
    expect(parsed.serviceContext).toBeDefined();
    expect(parsed.serviceContext.service).toBe("bank-statement-parser");
  });

  it("should log ingestion errors with context", () => {
    const error = new Error("Parse failed");
    logIngestionError("exp-123", "statement.pdf", error, "extraction");

    expect(console.error).toHaveBeenCalled();
    const output = (console.error as any).mock.calls[0][0];
    const parsed = JSON.parse(output);

    expect(parsed.event).toBe("ingestion_error");
    expect(parsed.metadata.stage).toBe("extraction");
    expect(parsed.metadata.fileName).toBe("statement.pdf");
    expect(parsed.exportId).toBe("exp-123");
    expect(parsed["@type"]).toContain("clouderrorreporting");
  });

  it("should log ingestion success with metrics", () => {
    logIngestionSuccess("exp-456", "statement.pdf", 42, "documentai", 150);

    expect(console.log).toHaveBeenCalled();
    const output = (console.log as any).mock.calls[0][0];
    const parsed = JSON.parse(output);

    expect(parsed.severity).toBe("INFO");
    expect(parsed.message).toBe("Ingestion completed successfully");
    expect(parsed.metadata.exportId).toBe("exp-456");
    expect(parsed.metadata.fileName).toBe("statement.pdf");
    expect(parsed.metadata.transactionCount).toBe(42);
    expect(parsed.metadata.source).toBe("documentai");
    expect(parsed.metadata.durationMs).toBe(150);
  });

  it("should handle errors without stack trace", () => {
    const error = { message: "String error" } as Error;
    logError("Something failed", error, { exportId: "test-123" });

    expect(console.error).toHaveBeenCalled();
    const output = (console.error as any).mock.calls[0][0];
    const parsed = JSON.parse(output);

    expect(parsed["@type"]).toContain("clouderrorreporting");
    expect(parsed.severity).toBe("ERROR");
  });

  it("should include service context in error logs", () => {
    const error = new Error("test error");
    logError("Something failed", error);

    const output = (console.error as any).mock.calls[0][0];
    const parsed = JSON.parse(output);

    expect(parsed.serviceContext).toBeDefined();
    expect(parsed.serviceContext.service).toBe("bank-statement-parser");
    expect(parsed.serviceContext.version).toBeDefined();
  });
});

