import { env as stdEnv } from "std-env";
import { z } from "zod";

const BoolEnv = z.preprocess((val) => {
  if (typeof val !== "string") {
    return val;
  }

  return ["true", "1"].includes(val.toLowerCase().trim());
}, z.boolean());

const Env = z.object({
  WARM_START_SERVICE_PORT: z.coerce.number().default(9021),
  CONNECTION_TIMEOUT_MS: z.coerce.number().default(30000),
  KEEPALIVE_MS: z.coerce.number().default(300000),
  MAX_POOL_SIZE: z.coerce.number().default(1000),
  DEBUG: BoolEnv.default(false),
});

export const env = Env.parse(stdEnv);
