import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { DequeuedMessage } from "@trigger.dev/core/v3/schemas";
import { SimpleStructuredLogger } from "@trigger.dev/core/v3/utils/structuredLogger";
import type { ContainerPool } from "../pool.js";

const logger = new SimpleStructuredLogger("route-warm-start");

const requiredHeaderNames = [
  "x-trigger-deployment-id",
  "x-trigger-deployment-version",
  "x-trigger-machine-cpu",
  "x-trigger-machine-memory",
  "x-trigger-workload-controller-id",
  "x-trigger-worker-instance-name",
] as const;

function readRequiredHeaders(
  req: IncomingMessage
): Record<(typeof requiredHeaderNames)[number], string> | null {
  const result = {} as Record<(typeof requiredHeaderNames)[number], string>;

  for (const name of requiredHeaderNames) {
    const value = req.headers[name];
    if (typeof value !== "string") {
      return null;
    }
    result[name] = value;
  }

  return result;
}

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
      const headers = readRequiredHeaders(req);

      if (!headers) {
        return reply.json(
          { ok: false, error: "Missing required headers" },
          false,
          400
        );
      }

      try {
        const message = await pool.enqueue({
          deploymentId: headers["x-trigger-deployment-id"],
          deploymentVersion: headers["x-trigger-deployment-version"],
          machineCpu: headers["x-trigger-machine-cpu"],
          machineMemory: headers["x-trigger-machine-memory"],
          controllerId: headers["x-trigger-workload-controller-id"],
          workerInstanceName: headers["x-trigger-worker-instance-name"],
          req,
        });

        reply.json(message);
      } catch (error) {
        if (error instanceof Error && error.message === "Pool is at max capacity") {
          return reply.json({ ok: false, error: "Pool is at max capacity" }, false, 503);
        }

        // Client disconnected -- connection is already closed, nothing to send
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
