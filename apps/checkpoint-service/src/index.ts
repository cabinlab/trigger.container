import { SimpleStructuredLogger } from "@trigger.dev/core/v3/utils/structuredLogger";
import { HttpServer } from "@trigger.dev/core/v3/serverOnly";
import { env } from "./env.js";
import { getWorkerToken } from "./workerToken.js";
import { getDockerClient } from "./docker/client.js";
import { createWebappClient } from "./webapp/client.js";
import { checkHealth, warmCriuCheck } from "./health.js";
import { createSuspendRoute } from "./routes/suspend.js";
import { createRestoreRoute } from "./routes/restore.js";

const logger = new SimpleStructuredLogger("checkpoint-service");

async function main() {
  logger.log("Starting checkpoint service");

  // 1. Resolve worker token (may read from file)
  const workerToken = getWorkerToken();

  // 2. Initialize Docker client
  const docker = getDockerClient({ dockerHost: env.DOCKER_HOST });

  // 3. Initialize webapp client
  const webappClient = createWebappClient({
    apiUrl: env.TRIGGER_API_URL,
    workerToken,
    instanceName: env.TRIGGER_WORKER_INSTANCE_NAME,
    deploymentId: env.TRIGGER_WORKER_DEPLOYMENT_ID,
    managedWorkerSecret: env.MANAGED_WORKER_SECRET,
  });

  // 4. Run initial health check and CRIU test
  const criuResult = await warmCriuCheck();
  if (criuResult.ok) {
    logger.log("CRIU checkpoint support available");
  } else {
    logger.warn("CRIU checkpoint support NOT available", { message: criuResult.message });
  }

  const healthResult = await checkHealth({
    docker,
    webappApiUrl: env.TRIGGER_API_URL,
    workerToken,
  });

  logger.log("Initial health check", {
    docker: healthResult.docker,
    criu: healthResult.criu,
    webapp: healthResult.webapp,
    details: healthResult.details,
  });

  // 5. Create route handlers
  const suspendRoute = createSuspendRoute({
    webappClient,
    checkpointDir: env.CHECKPOINT_STORAGE_DIR,
  });

  const restoreRoute = createRestoreRoute({
    checkpointDir: env.CHECKPOINT_STORAGE_DIR,
  });

  // 6. Build HTTP server
  const server = new HttpServer({
    port: env.CHECKPOINT_SERVICE_PORT,
    host: "0.0.0.0",
  });

  server
    .route("/health", "GET", {
      handler: async ({ reply }) => {
        const health = await checkHealth({
          docker,
          webappApiUrl: env.TRIGGER_API_URL,
          workerToken,
        });

        const status = health.docker && health.criu ? 200 : 503;
        reply.json(health, undefined, status);
      },
    })
    .route(
      "/api/v1/runs/:runId/snapshots/:snapshotId/suspend",
      "POST",
      suspendRoute
    )
    .route(
      "/api/v1/runs/:runId/snapshots/:snapshotId/restore",
      "POST",
      restoreRoute
    );

  // 7. Start listening
  await server.start();

  logger.log("Checkpoint service started", {
    port: env.CHECKPOINT_SERVICE_PORT,
    checkpointDir: env.CHECKPOINT_STORAGE_DIR,
  });
}

main().catch((error) => {
  logger.error("Fatal error starting checkpoint service", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
