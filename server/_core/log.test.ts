import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { logEvent, logIngestionError, serializeError } from "./log";

describe("log module", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe("serializeError", () => {
    it("serializes Error objects with name, message, and stack", () => {
      const error = new Error("Test error");
      const serialized = serializeError(error);

      expect(serialized.name).toBe("Error");
      expect(serialized.message).toBe("Test error");
      expect(serialized.stack).toBeDefined();
      expect(typeof serialized.stack).toBe("string");
    });

    it("serializes string errors", () => {
      const serialized = serializeError("Simple error string");

      expect(serialized.message).toBe("Simple error string");
    });

    it("handles unknown error types", () => {
      const serialized = serializeError({ custom: "error" });

      expect(serialized.message).toBe("Unknown error");
      expect(serialized.raw).toEqual({ custom: "error" });
    });
  });

  describe("logEvent", () => {
    it("logs info events with severity INFO", () => {
      logEvent("test_event", { key: "value" }, "info");

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput.severity).toBe("INFO");
      expect(logOutput.level).toBe("info");
      expect(logOutput.event).toBe("test_event");
      expect(logOutput.key).toBe("value");
      expect(logOutput.timestamp).toBeDefined();
      expect(logOutput.ts).toBeDefined();
    });

    it("logs warn events with severity WARNING", () => {
      logEvent("test_warning", { key: "value" }, "warn");

      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      const logOutput = JSON.parse(consoleWarnSpy.mock.calls[0][0]);

      expect(logOutput.severity).toBe("WARNING");
      expect(logOutput.level).toBe("warn");
      expect(logOutput.event).toBe("test_warning");
    });

    it("logs error events with severity ERROR", () => {
      logEvent("test_error", { key: "value" }, "error");

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const logOutput = JSON.parse(consoleErrorSpy.mock.calls[0][0]);

      expect(logOutput.severity).toBe("ERROR");
      expect(logOutput.level).toBe("error");
      expect(logOutput.event).toBe("test_error");
    });

    it("includes all provided fields in the log output", () => {
      logEvent("test_event", {
        exportId: "exp123",
        phase: "processing",
        fileName: "test.pdf",
      });

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput.exportId).toBe("exp123");
      expect(logOutput.phase).toBe("processing");
      expect(logOutput.fileName).toBe("test.pdf");
    });

    it("serializes Error objects in fields", () => {
      const error = new Error("Test error");
      logEvent("test_event", { error });

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

      expect(logOutput.error.name).toBe("Error");
      expect(logOutput.error.message).toBe("Test error");
      expect(logOutput.error.stack).toBeDefined();
    });
  });

  describe("logIngestionError", () => {
    it("logs ingestion errors with event=ingestion_error and severity ERROR", () => {
      logIngestionError("Failed to process document", {
        exportId: "exp456",
        phase: "docai",
        fileName: "statement.pdf",
      });

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const logOutput = JSON.parse(consoleErrorSpy.mock.calls[0][0]);

      expect(logOutput.severity).toBe("ERROR");
      expect(logOutput.level).toBe("error");
      expect(logOutput.event).toBe("ingestion_error");
      expect(logOutput.message).toBe("Failed to process document");
      expect(logOutput.exportId).toBe("exp456");
      expect(logOutput.phase).toBe("docai");
      expect(logOutput.fileName).toBe("statement.pdf");
    });

    it("includes serialized error with stack trace", () => {
      const error = new Error("Document AI timeout");
      logIngestionError("Failed to process document", {
        exportId: "exp789",
        error,
      });

      const logOutput = JSON.parse(consoleErrorSpy.mock.calls[0][0]);

      expect(logOutput.name).toBe("Error");
      expect(logOutput.message).toBe("Failed to process document");
      expect(logOutput.stack).toBeDefined();
      expect(typeof logOutput.stack).toBe("string");
      expect(logOutput.exportId).toBe("exp789");
    });

    it("handles null exportId", () => {
      logIngestionError("Parse failed", {
        exportId: null,
        phase: "normalize",
      });

      const logOutput = JSON.parse(consoleErrorSpy.mock.calls[0][0]);

      expect(logOutput.exportId).toBeNull();
      expect(logOutput.phase).toBe("normalize");
    });

    it("includes additional metadata fields", () => {
      logIngestionError("Document AI error", {
        exportId: "exp101",
        phase: "docai",
        documentType: "bank_statement",
        durationMs: 5000,
        processorId: "proc123",
      });

      const logOutput = JSON.parse(consoleErrorSpy.mock.calls[0][0]);

      expect(logOutput.exportId).toBe("exp101");
      expect(logOutput.phase).toBe("docai");
      expect(logOutput.documentType).toBe("bank_statement");
      expect(logOutput.durationMs).toBe(5000);
      expect(logOutput.processorId).toBe("proc123");
    });

    it("filters by event=ingestion_error", () => {
      logIngestionError("Test error 1", { exportId: "exp1" });
      logIngestionError("Test error 2", { exportId: "exp2" });
      logEvent("other_event", { key: "value" }, "error");

      expect(consoleErrorSpy).toHaveBeenCalledTimes(3);

      const ingestionErrors = consoleErrorSpy.mock.calls
        .map(call => JSON.parse(call[0]))
        .filter(log => log.event === "ingestion_error");

      expect(ingestionErrors).toHaveLength(2);
      expect(ingestionErrors[0].exportId).toBe("exp1");
      expect(ingestionErrors[1].exportId).toBe("exp2");
    });
  });

  describe("GCP Error Reporting compatibility", () => {
    it("outputs JSON with required GCP Error Reporting fields", () => {
      const error = new Error("Critical error");
      logIngestionError("System failure", {
        exportId: "exp999",
        error,
        phase: "unknown",
      });

      const logOutput = JSON.parse(consoleErrorSpy.mock.calls[0][0]);

      // GCP Error Reporting expects these fields
      expect(logOutput.severity).toBe("ERROR");
      expect(logOutput.message).toBeDefined();
      expect(logOutput.stack).toBeDefined();
      expect(logOutput.timestamp).toBeDefined();

      // Metadata for filtering
      expect(logOutput.exportId).toBeDefined();
      expect(logOutput.event).toBe("ingestion_error");
    });

    it("handles errors without stack traces gracefully", () => {
      logIngestionError("Simple error", {
        exportId: "exp888",
      });

      const logOutput = JSON.parse(consoleErrorSpy.mock.calls[0][0]);

      expect(logOutput.severity).toBe("ERROR");
      expect(logOutput.message).toBe("Simple error");
      expect(logOutput.exportId).toBe("exp888");
      // Should not crash even without explicit error object
    });
  });
});
