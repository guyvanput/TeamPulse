import "dotenv/config";
import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";
import { testDatabase } from "./tests/support/database";

const db = testDatabase();
await db.$disconnect();
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.AUTH_SECRET = randomBytes(32).toString("hex");
process.env.AUTH_TRUST_HOST = "true";
process.env.AUTH_URL = "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never" }], ["junit", { outputFile: "test-results/browser.xml" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "npm run start -- --port 3100",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    timeout: 90_000
  }
});
