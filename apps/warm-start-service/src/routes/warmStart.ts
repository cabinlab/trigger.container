import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { DequeuedMessage } from "@trigger.dev/core/v3/schemas";
import { SimpleStructuredLogger } from "@trigger.dev/core/v3/utils/structuredLogger";
import type { ContainerPool } from "../pool.js";

const logger = new SimpleStructuredLogger("route-warm-start");

export function createWarmStartGetRoute(pool: ContainerPool) {
  return {
    keepConnectionAlive: true,
    handler: async ({
      req,
      reply,
    }: {
      req: IncomingMessage;
      res: ServerResponse;
      reply: { json: (data: unknown, pretty?: boolean, status?: number) => void; empty: (status: number) => void };
    }) => {
      const deploymentId = req.headers["x-trigger-deployment-id"] as string | undefined;
      const deploymentVersion = req.headers["x-trigger-deployment-version"] as string | undefined;
      const machineCpu = req.headers["x-trigger-machine-cpu"] as string | undefined;
      const machineMemory = req.headers["x-trigger-machine-memory"] as string | undefined;
      const controllerId = req.headers["x-trigger-workload-controller-id"] as string | undefined;
      const workerInstanceName = req.headers["x-trigger-worker-instance-name"] as string | undefined;

      if (
        !deploymentId ||
        !deploymentVersion ||
        !machineCpu ||
        !machineMemory ||
        !controllerId ||
        !workerInstanceName
      ) {
        return reply.json(
          { ok: false, error: "Missing required headers" },
          false,
          400
        );
      }

      try {
        const message = await pool.enqueue({
          deploymentId,
          deploymentVersion,
          machineCpu,
          machineMemory,
          controllerId,
          workerInstanceName,
          req,
        });

        reply.json(message);
      } catch (error) {
        if (error instanceof Error && error.message === "Pool is at max capacity") {
          return reply.json({ ok: false, error: "Pool is at max capacity" }, false, 503);
        }

        // Client disconnected — connection is already closed, nothing to send
        logger.debug("GET /warm-start ended", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

const WarmStartPostBody = z.object({
  dequeuedMessage: DequeuedMessage,
});

export function createWarmStartPostRoute(pool: ContainerPool) {
  return {
    bodySchema: WarmStartPostBody,
    handler: async ({
      body,
      reply,
    }: {
      body: z.infer<typeof WarmStartPostBody>;
      reply: { json: (data: unknown) => void };
    }) => {
      const didWarmStart = pool.match(body.dequeuedMessage);
      reply.json({ didWarmStart });
    },
  };
}
