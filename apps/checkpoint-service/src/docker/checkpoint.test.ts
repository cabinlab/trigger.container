import { describe, test, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so these are available in hoisted vi.mock factories
const { mockExecFile, mockInspect, mockGetContainer } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockInspect: vi.fn(),
  mockGetContainer: vi.fn(() => ({ inspect: mockInspect })),
}));

// Mock child_process.execFile via promisify
vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));
vi.mock("node:util", () => ({
  promisify: () => {
    return (...args: unknown[]) => {
      return new Promise((resolve, reject) => {
        mockExecFile(...args, (err: Error | null, stdout: string, stderr: string) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        });
      });
    };
  },
}));

vi.mock("./client.js", () => ({
  getDockerClient: vi.fn(() => ({
    getContainer: mockGetContainer,
  })),
  createDockerClient: vi.fn(),
}));

import { createCheckpoint, restoreFromCheckpoint } from "./checkpoint.js";

describe("createCheckpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mockGetContainer to return fresh inspect mock
    mockGetContainer.mockReturnValue({ inspect: mockInspect });
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

  test("calls docker checkpoint create with correct args on success", async () => {
    mockInspect.mockResolvedValueOnce({ State: { Running: true } });
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], cb: (err: null, stdout: string, stderr: string) => void) => {
        cb(null, "chk-snap1\n", "");
      }
    );

    const result = await createCheckpoint("runner-abc123", "chk-snap1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.checkpointName).toBe("chk-snap1");
      expect(result.containerId).toBe("runner-abc123");
    }

    expect(mockExecFile).toHaveBeenCalledWith(
      "docker",
      ["checkpoint", "create", "runner-abc123", "chk-snap1"],
      expect.any(Function)
    );
  });

  test("passes --checkpoint-dir when provided", async () => {
    mockInspect.mockResolvedValueOnce({ State: { Running: true } });
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], cb: (err: null, stdout: string, stderr: string) => void) => {
        cb(null, "chk-snap1\n", "");
      }
    );

    await createCheckpoint("runner-abc123", "chk-snap1", {
      checkpointDir: "/data/checkpoints",
    });

    expect(mockExecFile).toHaveBeenCalledWith(
      "docker",
      [
        "checkpoint",
        "create",
        "--checkpoint-dir",
        "/data/checkpoints",
        "runner-abc123",
        "chk-snap1",
      ],
      expect.any(Function)
    );
  });

  test("does not pass --checkpoint-dir when undefined", async () => {
    mockInspect.mockResolvedValueOnce({ State: { Running: true } });
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], cb: (err: null, stdout: string, stderr: string) => void) => {
        cb(null, "chk-snap1\n", "");
      }
    );

    await createCheckpoint("runner-abc123", "chk-snap1", {});

    const callArgs = mockExecFile.mock.calls[0]?.[1] as string[];
    expect(callArgs).not.toContain("--checkpoint-dir");
  });

  test("passes --leave-running when requested", async () => {
    mockInspect.mockResolvedValueOnce({ State: { Running: true } });
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], cb: (err: null, stdout: string, stderr: string) => void) => {
        cb(null, "chk-snap1\n", "");
      }
    );

    await createCheckpoint("runner-abc123", "chk-snap1", { leaveRunning: true });

    const callArgs = mockExecFile.mock.calls[0]?.[1] as string[];
    expect(callArgs).toContain("--leave-running");
  });

  test("classifies CRIU not available error", async () => {
    mockInspect.mockResolvedValueOnce({ State: { Running: true } });
    const error = Object.assign(new Error("criu binary not found"), {
      stderr: "Error: criu binary not found in PATH",
    });
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], cb: (err: Error) => void) => {
        cb(error);
      }
    );

    const result = await createCheckpoint("runner-abc123", "chk-snap1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("CRIU_NOT_AVAILABLE");
    }
  });

  test("classifies experimental features error", async () => {
    mockInspect.mockResolvedValueOnce({ State: { Running: true } });
    const error = Object.assign(new Error("experimental"), {
      stderr: "Error response from daemon: experimental features must be enabled",
    });
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], cb: (err: Error) => void) => {
        cb(error);
      }
    );

    const result = await createCheckpoint("runner-abc123", "chk-snap1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("CRIU_NOT_AVAILABLE");
    }
  });

  test("classifies checkpoint already exists error", async () => {
    mockInspect.mockResolvedValueOnce({ State: { Running: true } });
    const error = Object.assign(new Error("exists"), {
      stderr: "Error: checkpoint with name chk-snap1 already exists",
    });
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], cb: (err: Error) => void) => {
        cb(error);
      }
    );

    const result = await createCheckpoint("runner-abc123", "chk-snap1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("CHECKPOINT_EXISTS");
    }
  });
});

describe("restoreFromCheckpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContainer.mockReturnValue({ inspect: mockInspect });
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

  test("calls docker start --checkpoint with correct args on success", async () => {
    mockInspect.mockResolvedValueOnce({ State: { Status: "exited" } });
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], cb: (err: null, stdout: string, stderr: string) => void) => {
        cb(null, "runner-abc123\n", "");
      }
    );

    const result = await restoreFromCheckpoint("runner-abc123", "chk-snap1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.containerId).toBe("runner-abc123");
    }

    expect(mockExecFile).toHaveBeenCalledWith(
      "docker",
      ["start", "--checkpoint=chk-snap1", "runner-abc123"],
      expect.any(Function)
    );
  });

  test("passes --checkpoint-dir when provided", async () => {
    mockInspect.mockResolvedValueOnce({ State: { Status: "exited" } });
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], cb: (err: null, stdout: string, stderr: string) => void) => {
        cb(null, "runner-abc123\n", "");
      }
    );

    await restoreFromCheckpoint("runner-abc123", "chk-snap1", {
      checkpointDir: "/data/checkpoints",
    });

    expect(mockExecFile).toHaveBeenCalledWith(
      "docker",
      ["start", "--checkpoint=chk-snap1", "--checkpoint-dir=/data/checkpoints", "runner-abc123"],
      expect.any(Function)
    );
  });

  test("does not pass --checkpoint-dir when undefined", async () => {
    mockInspect.mockResolvedValueOnce({ State: { Status: "exited" } });
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], cb: (err: null, stdout: string, stderr: string) => void) => {
        cb(null, "runner-abc123\n", "");
      }
    );

    await restoreFromCheckpoint("runner-abc123", "chk-snap1", {});

    const callArgs = mockExecFile.mock.calls[0]?.[1] as string[];
    expect(callArgs).toEqual(["start", "--checkpoint=chk-snap1", "runner-abc123"]);
  });

  test("classifies checkpoint not found error", async () => {
    mockInspect.mockResolvedValueOnce({ State: { Status: "exited" } });
    const error = Object.assign(new Error("not found"), {
      stderr: "Error: checkpoint chk-snap1 does not exist for container runner-abc123",
    });
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], cb: (err: Error) => void) => {
        cb(error);
      }
    );

    const result = await restoreFromCheckpoint("runner-abc123", "chk-snap1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("CHECKPOINT_NOT_FOUND");
    }
  });
});
