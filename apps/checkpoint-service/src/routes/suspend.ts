import { z } from "zod";
import { SimpleStructuredLogger } from "@trigger.dev/core/v3/utils/structuredLogger";
import {
  CheckpointServiceSuspendRequestBody,
  CheckpointServiceSuspendResponseBody,
} from "@trigger.dev/core/v3/schemas";
import { createCheckpoint } from "../docker/checkpoint.js";
import type { WebappClient } from "../webapp/client.js";

const logger = new SimpleStructuredLogger("route-suspend");

const SuspendParams = z.object({
  runId: z.string(),
  snapshotId: z.string(),
});

export function createSuspendRoute(deps: { webappClient: WebappClient; checkpointDir?: string }) {
  return {
    paramsSchema: SuspendParams,
    bodySchema: CheckpointServiceSuspendRequestBody,
    handler: async ({
      reply,
      params,
      body,
    }: {
      reply: { json: (data: unknown, success?: boolean, status?: number) => void };
      params: z.infer<typeof SuspendParams>;
      body: z.infer<typeof CheckpointServiceSuspendRequestBody>;
    }) => {
      const { runId, snapshotId } = params;

      logger.log("Suspend request received", {
        runId,
        snapshotId,
        runnerId: body.runnerId,
        reason: body.reason,
      });

      // Acknowledge receipt immediately
      reply.json({ ok: true } satisfies CheckpointServiceSuspendResponseBody);

      // Perform checkpoint asynchronously after responding
      const checkpointName = `chk-${snapshotId}`;

      const result = await createCheckpoint(body.runnerId, checkpointName, {
        checkpointDir: deps.checkpointDir,
      });

      if (result.success) {
        logger.log("Checkpoint created, reporting success", {
          runId,
          snapshotId,
          checkpointName,
        });

        await deps.webappClient.reportSuspendResult(runId, snapshotId, {
          success: true,
          checkpoint: { type: "DOCKER", location: checkpointName },
        });
      } else {
        logger.error("Checkpoint failed, reporting failure", {
          runId,
          snapshotId,
          error: result.error,
          code: result.code,
        });

        await deps.webappClient.reportSuspendResult(runId, snapshotId, {
          success: false,
          error: result.error,
        });
      }
    },
  };
}
