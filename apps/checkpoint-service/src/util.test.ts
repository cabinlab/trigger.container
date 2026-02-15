import { describe, test, expect } from "vitest";
import { deriveContainerName } from "./util.js";

describe("deriveContainerName", () => {
  test("strips run_ prefix and prepends runner-", () => {
    expect(deriveContainerName("run_abc123")).toBe("runner-abc123");
  });

  test("handles attempt 1 (no suffix)", () => {
    expect(deriveContainerName("run_abc123", 1)).toBe("runner-abc123");
  });

  test("appends attempt suffix for attempt > 1", () => {
    expect(deriveContainerName("run_abc123", 2)).toBe("runner-abc123-attempt-2");
    expect(deriveContainerName("run_abc123", 5)).toBe("runner-abc123-attempt-5");
  });

  test("handles undefined attemptNumber", () => {
    expect(deriveContainerName("run_xyz")).toBe("runner-xyz");
  });

  test("handles friendlyId without run_ prefix gracefully", () => {
    // If for some reason the prefix is missing, replace is a no-op
    expect(deriveContainerName("abc123")).toBe("runner-abc123");
  });

  test("handles attempt 0 (no suffix)", () => {
    // 0 is falsy, so no attempt suffix
    expect(deriveContainerName("run_abc123", 0)).toBe("runner-abc123");
  });
});
