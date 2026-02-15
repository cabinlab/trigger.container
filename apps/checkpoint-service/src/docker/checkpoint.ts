import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Docker from "dockerode";
import { SimpleStructuredLogger } from "@trigger.dev/core/v3/utils/structuredLogger";
import { getDockerClient, type DockerClientConfig } from "./client.js";

const execFileAsync = promisify(execFile);

const logger = new SimpleStructuredLogger("docker-checkpoint");

// ── Result types ──────────────────────────────────────────────────────────────

export type CheckpointResult =
  | { success: true; checkpointName: string; containerId: string }
  | { success: false; error: string; code: CheckpointErrorCode };

export type RestoreResult =
  | { success: true; containerId: string }
  | { success: false; error: string; code: RestoreErrorCode };

export type CheckpointErrorCode =
  | "CONTAINER_NOT_FOUND"
  | "CRIU_NOT_AVAILABLE"
  | "CHECKPOINT_EXISTS"
  | "DOCKER_ERROR"
  | "UNKNOWN";

export type RestoreErrorCode =
  | "CONTAINER_NOT_FOUND"
  | "CHECKPOINT_NOT_FOUND"
  | "CRIU_NOT_AVAILABLE"
  | "DOCKER_ERROR"
  | "UNKNOWN";

// ── Options ───────────────────────────────────────────────────────────────────

export type CreateCheckpointOptions = {
  /** External directory for checkpoint storage. Maps to --checkpoint-dir. */
  checkpointDir?: string;
  /** Keep the container running after checkpoint (--leave-running). */
  leaveRunning?: boolean;
};

export type RestoreFromCheckpointOptions = {
  /** External directory where the checkpoint is stored. Maps to --checkpoint-dir. */
  checkpointDir?: string;
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Creates a CRIU checkpoint of a running Docker container.
 *
 * Equivalent to: `docker checkpoint create [--leave-running] [--checkpoint-dir=DIR] CONTAINER NAME`
 */
export async function createCheckpoint(
  containerId: string,
  checkpointName: string,
  options: CreateCheckpointOptions = {},
  dockerConfig?: DockerClientConfig
): Promise<CheckpointResult> {
  const docker = getDockerClient(dockerConfig);

  // Validate container exists
  const containerCheck = await inspectContainer(docker, containerId);
  if (!containerCheck.exists) {
    logger.error("Container not found for checkpoint", { containerId, checkpointName });
    return {
      success: false,
      error: `Container '${containerId}' not found`,
      code: "CONTAINER_NOT_FOUND",
    };
  }

  // Build the docker checkpoint create command
  const args = ["checkpoint", "create"];

  if (options.leaveRunning) {
    args.push("--leave-running");
  }

  if (options.checkpointDir) {
    args.push("--checkpoint-dir", options.checkpointDir);
  }

  args.push(containerId, checkpointName);

  logger.log("Creating checkpoint", { containerId, checkpointName, options });

  try {
    const { stdout, stderr } = await execFileAsync("docker", args);

    if (stderr && !stderr.includes(checkpointName)) {
      logger.warn("Checkpoint created with warnings", { containerId, checkpointName, stderr });
    }

    logger.log("Checkpoint created successfully", {
      containerId,
      checkpointName,
      stdout: stdout.trim(),
    });

    return { success: true, checkpointName, containerId };
  } catch (error) {
    return {
      success: false,
      ...classifyCheckpointError(error, containerId, checkpointName),
    };
  }
}

/**
 * Restores a Docker container from a CRIU checkpoint.
 *
 * Equivalent to: `docker start --checkpoint=NAME [--checkpoint-dir=DIR] CONTAINER`
 */
export async function restoreFromCheckpoint(
  containerId: string,
  checkpointName: string,
  options: RestoreFromCheckpointOptions = {},
  dockerConfig?: DockerClientConfig
): Promise<RestoreResult> {
  const docker = getDockerClient(dockerConfig);

  // Validate container exists
  const containerCheck = await inspectContainer(docker, containerId);
  if (!containerCheck.exists) {
    logger.error("Container not found for restore", { containerId, checkpointName });
    return {
      success: false,
      error: `Container '${containerId}' not found`,
      code: "CONTAINER_NOT_FOUND",
    };
  }

  // Build the docker start --checkpoint command
  const args = ["start", `--checkpoint=${checkpointName}`];

  if (options.checkpointDir) {
    args.push(`--checkpoint-dir=${options.checkpointDir}`);
  }

  args.push(containerId);

  logger.log("Restoring from checkpoint", { containerId, checkpointName, options });

  try {
    const { stdout, stderr } = await execFileAsync("docker", args);

    if (stderr) {
      logger.warn("Restore completed with warnings", { containerId, checkpointName, stderr });
    }

    logger.log("Restored from checkpoint successfully", {
      containerId,
      checkpointName,
      stdout: stdout.trim(),
    });

    return { success: true, containerId };
  } catch (error) {
    return {
      success: false,
      ...classifyRestoreError(error, containerId, checkpointName),
    };
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function inspectContainer(
  docker: Docker,
  containerId: string
): Promise<{ exists: true; info: Docker.ContainerInspectInfo } | { exists: false }> {
  try {
    const info = await docker.getContainer(containerId).inspect();
    return { exists: true, info };
  } catch (error: unknown) {
    if (isDockerError(error) && error.statusCode === 404) {
      return { exists: false };
    }
    // Re-throw unexpected errors (e.g. socket issues)
    throw error;
  }
}

function isDockerError(error: unknown): error is { statusCode: number; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof (error as Record<string, unknown>).statusCode === "number"
  );
}

interface ExecError {
  stderr?: string;
  message?: string;
  code?: number | string;
}

function getStderr(error: unknown): string {
  const e = error as ExecError;
  return e.stderr ?? e.message ?? String(error);
}

function classifyCheckpointError(
  error: unknown,
  containerId: string,
  checkpointName: string
): { error: string; code: CheckpointErrorCode } {
  const stderr = getStderr(error);

  logger.error("Checkpoint creation failed", { containerId, checkpointName, stderr });

  if (stderr.includes("No such container")) {
    return { error: `Container '${containerId}' not found`, code: "CONTAINER_NOT_FOUND" };
  }
  if (stderr.includes("criu") && stderr.includes("not found")) {
    return { error: "CRIU binary not found on the host", code: "CRIU_NOT_AVAILABLE" };
  }
  if (stderr.includes("experimental")) {
    return {
      error: "Docker experimental features must be enabled for checkpoints",
      code: "CRIU_NOT_AVAILABLE",
    };
  }
  if (stderr.includes("already exists") || stderr.includes("checkpoint with name")) {
    return {
      error: `Checkpoint '${checkpointName}' already exists for container '${containerId}'`,
      code: "CHECKPOINT_EXISTS",
    };
  }

  return { error: stderr, code: "DOCKER_ERROR" };
}

function classifyRestoreError(
  error: unknown,
  containerId: string,
  checkpointName: string
): { error: string; code: RestoreErrorCode } {
  const stderr = getStderr(error);

  logger.error("Checkpoint restore failed", { containerId, checkpointName, stderr });

  if (stderr.includes("No such container")) {
    return { error: `Container '${containerId}' not found`, code: "CONTAINER_NOT_FOUND" };
  }
  if (stderr.includes("checkpoint") && stderr.includes("does not exist")) {
    return {
      error: `Checkpoint '${checkpointName}' not found for container '${containerId}'`,
      code: "CHECKPOINT_NOT_FOUND",
    };
  }
  if (stderr.includes("criu") && stderr.includes("not found")) {
    return { error: "CRIU binary not found on the host", code: "CRIU_NOT_AVAILABLE" };
  }

  return { error: stderr, code: "DOCKER_ERROR" };
}
