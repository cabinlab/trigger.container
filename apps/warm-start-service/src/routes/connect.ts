import { env } from "../env.js";

export function createConnectRoute() {
  return {
    handler: async ({ reply }: { reply: { json: (data: unknown) => void } }) => {
      reply.json({
        connectionTimeoutMs: env.CONNECTION_TIMEOUT_MS,
        keepaliveMs: env.KEEPALIVE_MS,
      });
    },
  };
}
