import type Dockerode from "dockerode";
import { testDockerCheckpoint, type CheckpointTestResult } from "@trigger.dev/core/v3/serverOnly";

export type HealthResult = {
  docker: boolean;
  criu: boolean;
  webapp: boolean;
  details: Record<string, string>;
};

export type HealthConfig = {
  docker: Dockerode;
  webappApiUrl: string;
  workerToken: string;
};

let cachedCriuResult: CheckpointTestResult | null = null;

/**
 * Run the CRIU checkpoint test once and cache the result.
 * Call this at startup to pre-warm the cached result.
 */
export async function warmCriuCheck(): Promise<CheckpointTestResult> {
  cachedCriuResult = await testDockerCheckpoint();
  return cachedCriuResult;
}

export async function checkHealth(config: HealthConfig): Promise<HealthResult> {
  const details: Record<string, string> = {};

  // Docker check: ping the daemon
  let dockerOk = false;
  try {
    await config.docker.ping();
    dockerOk = true;
    details.docker = "connected";
  } catch (error) {
    details.docker = error instanceof Error ? error.message : "unreachable";
  }

  // CRIU check: use cached result from startup test
  let criuOk = false;
  if (cachedCriuResult) {
    criuOk = cachedCriuResult.ok;
    details.criu = cachedCriuResult.ok ? "available" : cachedCriuResult.message;
  } else {
    details.criu = "not tested yet";
  }

  // Webapp check: attempt to reach the webapp API
  let webappOk = false;
  try {
    const url = `${config.webappApiUrl.replace(/\/$/, "")}/api/v1/health`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.workerToken}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    webappOk = res.ok;
    details.webapp = res.ok ? "reachable" : `status ${res.status}`;
  } catch (error) {
    details.webapp = error instanceof Error ? error.message : "unreachable";
  }

  return {
    docker: dockerOk,
    criu: criuOk,
    webapp: webappOk,
    details,
  };
}
