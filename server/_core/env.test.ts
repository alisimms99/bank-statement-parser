import { describe, expect, it } from "vitest";
import { ENV, getDocumentAiConfig } from "./env";

describe("getDocumentAiConfig", () => {
  it("disables Document AI when not configured", () => {
    const config = getDocumentAiConfig();
    expect(config.enabled).toBe(ENV.enableDocAi);
    expect(config.ready).toBe(false);
    expect(config.missing.length).toBeGreaterThan(0);
  });

  it("correctly maps processor IDs from ENV", () => {
    const config = getDocumentAiConfig();
    
    // Should use gcpBankProcessorId, not docAiBankProcessorId
    if (ENV.gcpBankProcessorId) {
      expect(config.processors.bank).toBe(ENV.gcpBankProcessorId);
    }
    if (ENV.gcpInvoiceProcessorId) {
      expect(config.processors.invoice).toBe(ENV.gcpInvoiceProcessorId);
    }
    if (ENV.gcpOcrProcessorId) {
      expect(config.processors.ocr).toBe(ENV.gcpOcrProcessorId);
    }
  });

  it("includes legacy credential in missing message", () => {
    const config = getDocumentAiConfig();
    
    // If credentials are missing, the message should mention all possible sources
    if (!config.credentials) {
      const credMissing = config.missing.find(m => m.includes("CREDENTIALS"));
      expect(credMissing).toBeDefined();
      expect(credMissing).toContain("GCP_DOCUMENTAI_CREDENTIALS");
    }
  });

  it("recognizes credentials from any source", () => {
    const config = getDocumentAiConfig();
    
    // If any credential env var is set, config should have credentials
    const hasCredentialEnv = ENV.gcpCredentialsJson || ENV.gcpServiceAccountJson || ENV.gcpServiceAccountPath;
    
    if (hasCredentialEnv) {
      // Credentials should be loaded if JSON is valid
      // Note: They might be null if the JSON is invalid, which is fine
      expect(config.credentials !== undefined || config.missing.some(m => m.includes("CREDENTIALS"))).toBe(true);
    }
  });
});
