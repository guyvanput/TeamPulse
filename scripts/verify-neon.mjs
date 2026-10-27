import "dotenv/config";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";

const [branch, profile = "teampulse"] = process.argv.slice(2);
if (!branch?.startsWith("br-")) throw new Error("Provide the id of a disposable Neon verification branch.");
const cli = resolve(dirname(process.execPath), "node_modules", "neon", "dist", "cli.js");
const project = "morning-sunset-56865380";
function neon(args) {
  return execFileSync(process.execPath, [cli, ...args, "--profile", profile, "--project-id", project], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

const info = JSON.parse(neon(["branches", "get", branch, "--output", "json"]));
const details = info.branch ?? info;
if (details.default || details.protected || !details.name?.startsWith("teampulse-verification-")) {
  throw new Error("Refusing to test outside a disposable teampulse-verification branch.");
}
const direct = neon(["connection-string", branch, "--database-name", "teampulse_test", "--ssl", "verify-full"]);
const pooled = neon(["connection-string", branch, "--database-name", "teampulse_test", "--pooled", "--ssl", "verify-full"]);
const url = new URL(pooled);
if (!url.hostname.endsWith(".neon.tech") || url.pathname !== "/teampulse_test") {
  throw new Error("Unexpected test database target.");
}
process.env.DATABASE_URL = pooled;
process.env.DATABASE_URL_UNPOOLED = direct;
process.env.TEST_DATABASE_URL = pooled;
process.env.NEON_TEST_DATABASE_HOST = url.hostname;
process.env.NEXT_TELEMETRY_DISABLED = "1";
const npmCli = process.env.npm_execpath ??
  resolve(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
for (const command of ["db:migrate", "gate:merge"]) {
  const result = spawnSync(process.execPath, [npmCli, "run", command], { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.info("Neon isolated-branch verification passed. No production fixtures were created.");
