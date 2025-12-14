import { describe, it, expect, vi } from "vitest";

// Import the functions we want to test
import { recordFirstRequest, getColdStartDuration, isColdStart, getContainerStartTime } from "./coldStart";

describe("Cold Start Tracking", () => {
  describe("recordFirstRequest", () => {
    it("should return null on subsequent calls after first request", () => {
      // Call recordFirstRequest - may return duration or null depending on test order
      recordFirstRequest();
      
      // Subsequent calls should always return null
      const secondDuration = recordFirstRequest();
      expect(secondDuration).toBeNull();
      
      const thirdDuration = recordFirstRequest();
      expect(thirdDuration).toBeNull();
    });
  });

  describe("getColdStartDuration", () => {
    it("should return a numeric value or null", () => {
      // After any request has been made, duration will be set
      const duration = getColdStartDuration();
      
      // Duration should be either null (no request yet) or a positive number
      if (duration !== null) {
        expect(duration).toBeGreaterThanOrEqual(0);
        expect(typeof duration).toBe("number");
      }
    });

    it("should return the same duration on multiple calls", () => {
      const duration1 = getColdStartDuration();
      const duration2 = getColdStartDuration();
      const duration3 = getColdStartDuration();
      
      // All calls should return the same value (cached)
      expect(duration1).toBe(duration2);
      expect(duration2).toBe(duration3);
    });
  });

  describe("isColdStart", () => {
    it("should return false after first request has been recorded", () => {
      // Ensure at least one request has been recorded
      recordFirstRequest();
      
      // Should no longer be a cold start
      const result = isColdStart();
      expect(result).toBe(false);
    });
  });

  describe("getContainerStartTime", () => {
    it("should return a valid timestamp", () => {
      const startTime = getContainerStartTime();
      
      expect(typeof startTime).toBe("number");
      expect(startTime).toBeGreaterThan(0);
      expect(startTime).toBeLessThanOrEqual(Date.now());
    });

    it("should return the same value on multiple calls", () => {
      const time1 = getContainerStartTime();
      const time2 = getContainerStartTime();
      const time3 = getContainerStartTime();
      
      expect(time1).toBe(time2);
      expect(time2).toBe(time3);
    });
  });

  describe("Integration", () => {
    it("should maintain consistent state after recording first request", () => {
      // Record at least one request
      recordFirstRequest();
      
      // Verify consistent state
      expect(isColdStart()).toBe(false);
      
      const duration = getColdStartDuration();
      expect(duration).not.toBeNull();
      expect(duration).toBeGreaterThanOrEqual(0);
      
      // Subsequent requests should not change state
      const secondRequest = recordFirstRequest();
      expect(secondRequest).toBeNull();
      expect(getColdStartDuration()).toBe(duration);
      expect(isColdStart()).toBe(false);
    });

    it("should have a cold start duration that represents time since container start", () => {
      const containerStart = getContainerStartTime();
      const duration = getColdStartDuration();
      
      // If duration is set, it should be reasonable
      if (duration !== null) {
        const now = Date.now();
        const timeSinceContainerStart = now - containerStart;
        
        // Duration should be positive and less than time since container start
        expect(duration).toBeGreaterThanOrEqual(0);
        expect(duration).toBeLessThanOrEqual(timeSinceContainerStart);
      }
    });
  });
});
