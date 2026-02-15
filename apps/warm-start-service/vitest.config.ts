import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["@triggerdotdev/source"],
  },
  test: {
    include: ["src/**/*.test.ts"],
    globals: true,
  },
});
