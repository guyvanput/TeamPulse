import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./tests/support/server-only.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  test: {
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/support/setup.ts"],
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 30_000
  }
});
