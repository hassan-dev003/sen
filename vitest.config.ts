import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)).replace(/\/$/, ""),
    },
  },
  test: {
    environment: "node",
    // Unit tests only. The RLS integration test needs a live Postgres and runs
    // via a separate config (vitest.integration.config.ts) in its own CI job.
    include: ["lib/**/*.test.ts"],
    globals: false,
  },
});
