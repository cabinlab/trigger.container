import { SupervisorHttpClient } from "@trigger.dev/core/v3/runEngineWorker";

export type WebappClientConfig = {
  apiUrl: string;
  workerToken: string;
  instanceName: string;
  deploymentId?: string;
  managedWorkerSecret?: string;
};

export type SuspendResult =
  | { success: true; checkpoint: { type: "DOCKER"; location: string } }
  | { success: false; error: string };

export class WebappClient {
  private readonly httpClient: SupervisorHttpClient;

  constructor(config: WebappClientConfig) {
    this.httpClient = new SupervisorHttpClient({
      apiUrl: config.apiUrl,
      workerToken: config.workerToken,
      instanceName: config.instanceName,
      deploymentId: config.deploymentId,
      managedWorkerSecret: config.managedWorkerSecret,
    });
  }

  async reportSuspendResult(
    runFriendlyId: string,
    snapshotFriendlyId: string,
    result: SuspendResult
  ) {
    return this.httpClient.submitSuspendCompletion({
      runId: runFriendlyId,
      snapshotId: snapshotFriendlyId,
      body: result,
    });
  }
}

export function createWebappClient(config: WebappClientConfig): WebappClient {
  return new WebappClient(config);
}
