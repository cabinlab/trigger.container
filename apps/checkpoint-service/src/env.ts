import { randomUUID } from "crypto";
import { env as stdEnv } from "std-env";
import { z } from "zod";

const BoolEnv = z.preprocess((val) => {
  if (typeof val !== "string") {
    return val;
  }

  return ["true", "1"].includes(val.toLowerCase().trim());
}, z.boolean());

const Env = z.object({
  // Required settings
  TRIGGER_API_URL: z.string().url(),
  TRIGGER_WORKER_TOKEN: z.string(), // accepts file:// path to read from a file
  MANAGED_WORKER_SECRET: z.string(),
  TRIGGER_WORKER_INSTANCE_NAME: z.string().default(randomUUID()),
  TRIGGER_WORKER_DEPLOYMENT_ID: z.string(),

  // Checkpoint service settings
  CHECKPOINT_SERVICE_PORT: z.coerce.number().default(9020),
  CHECKPOINT_STORAGE_DIR: z.string().default("/checkpoints"),

  // Docker settings
  DOCKER_HOST: z.string().optional(),

  // Debug
  DEBUG: BoolEnv.default(false),
});

export const env = Env.parse(stdEnv);
