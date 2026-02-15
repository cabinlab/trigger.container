import { SimpleStructuredLogger } from "@trigger.dev/core/v3/utils/structuredLogger";
import { HttpServer } from "@trigger.dev/core/v3/serverOnly";
import { env } from "./env.js";
import { ContainerPool } from "./pool.js";
import { createConnectRoute } from "./routes/connect.js";
import { createWarmStartGetRoute, createWarmStartPostRoute } from "./routes/warmStart.js";

const logger = new SimpleStructuredLogger("warm-start-service");

async function main() {
  logger.log("Starting warm start service");

  const pool = new ContainerPool({ maxPoolSize: env.MAX_POOL_SIZE });

  const server = new HttpServer({
    port: env.WARM_START_SERVICE_PORT,
    host: "0.0.0.0",
  });

  server
    .route("/health", "GET", {
      handler: async ({ reply }) => {
        reply.json({ status: "ok", pool: pool.stats() });
      },
    })
    .route("/connect", "GET", createConnectRoute())
    .route("/warm-start", "GET", createWarmStartGetRoute(pool))
    .route("/warm-start", "POST", createWarmStartPostRoute(pool));

  await server.start();

  logger.log("Warm start service started", {
    port: env.WARM_START_SERVICE_PORT,
    maxPoolSize: env.MAX_POOL_SIZE,
  });
}

main().catch((error) => {
  logger.error("Fatal error starting warm start service", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
