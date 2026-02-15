import { describe, test, expect, vi, beforeEach } from "vitest";
import { createCheckpoint, restoreFromCheckpoint } from "./checkpoint.js";

// Mock dockerode
const mockInspect = vi.fn();
const mockGetContainer = vi.fn(() => ({ inspect: mockInspect }));

// Mock the client module to return our mock Docker instance
vi.mock("./client.js", () => ({
  getDockerClient: vi.fn(() => ({
    getContainer: mockGetContainer,
  })),
  createDockerClient: vi.fn(),
}));

describe("createCheckpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns CONTAINER_NOT_FOUND when container does not exist", async () => {
    mockInspect.mockRejectedValueOnce({ statusCode: 404, message: "not found" });

    const result = await createCheckpoint("runner-abc123", "chk-snap1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("CONTAINER_NOT_FOUND");
      expect(result.error).toContain("runner-abc123");
    }
  });

  test("propagates unexpected Docker inspect errors", async () => {
    mockInspect.mockRejectedValueOnce(new Error("socket hangup"));

    await expect(createCheckpoint("runner-abc123", "chk-snap1")).rejects.toThrow("socket hangup");
  });
});

describe("restoreFromCheckpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns CONTAINER_NOT_FOUND when container does not exist", async () => {
    mockInspect.mockRejectedValueOnce({ statusCode: 404, message: "not found" });

    const result = await restoreFromCheckpoint("runner-abc123", "chk-snap1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("CONTAINER_NOT_FOUND");
      expect(result.error).toContain("runner-abc123");
    }
  });

  test("propagates unexpected Docker inspect errors", async () => {
    mockInspect.mockRejectedValueOnce(new Error("connection refused"));

    await expect(restoreFromCheckpoint("runner-abc123", "chk-snap1")).rejects.toThrow(
      "connection refused"
    );
  });
});
