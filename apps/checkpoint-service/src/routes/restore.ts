import { z } from "zod";
import { SimpleStructuredLogger } from "@trigger.dev/core/v3/utils/structuredLogger";
import { CheckpointServiceRestoreRequestBody } from "@trigger.dev/core/v3/schemas";
import { restoreFromCheckpoint } from "../docker/checkpoint.js";
import { deriveContainerName } from "../util.js";

const logger = new SimpleStructuredLogger("route-restore");

const RestoreParams = z.object({
  runId: z.string(),
  snapshotId: z.string(),
});

export function createRestoreRoute(deps: { checkpointDir?: string }) {
  return {
    paramsSchema: RestoreParams,
    bodySchema: CheckpointServiceRestoreRequestBody,
    handler: async ({
      reply,
      params,
      body,
    }: {
      reply: {
        json: (data: unknown, success?: boolean, status?: number) => void;
        empty: (status: number) => void;
      };
      params: z.infer<typeof RestoreParams>;
      body: z.infer<typeof CheckpointServiceRestoreRequestBody>;
    }) => {
      const { runId, snapshotId } = params;
      const { checkpoint } = body;

      // Derive the Docker container name using the same convention as the supervisor's
      // getRunnerId() in apps/supervisor/src/util.ts:
      //   runner-{runIdWithoutPrefix}[-attempt-{n}]
      const containerId = deriveContainerName(body.run.friendlyId, body.run.attemptNumber);
      const checkpointName = checkpoint.location;

      logger.log("Restore request received", {
        runId,
        snapshotId,
        containerId,
        checkpointLocation: checkpoint.location,
        checkpointType: checkpoint.type,
      });

      const result = await restoreFromCheckpoint(containerId, checkpointName, {
        checkpointDir: deps.checkpointDir,
      });

      if (result.success) {
        logger.log("Restore successful", {
          runId,
          snapshotId,
          containerId: result.containerId,
        });

        reply.json({ ok: true });
      } else {
        logger.error("Restore failed", {
          runId,
          snapshotId,
          error: result.error,
          code: result.code,
        });

        reply.json({ ok: false, error: result.error }, false, 500);
      }
    },
  };
}

