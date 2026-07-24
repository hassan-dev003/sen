import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests that require a live Supabase stack (URL + anon key +
// service-role key in the environment). Run via `pnpm test:rls`, which in CI
// boots a local Supabase with `supabase start` first.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)).replace(/\/$/, ""),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globals: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
