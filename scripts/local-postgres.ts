import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const databaseDir = resolve(".local", "postgres");
const pg = new EmbeddedPostgres({
  databaseDir, user: "teampulse", password: "local-dev-only",
  port: 55432, persistent: true, authMethod: "scram-sha-256",
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: ["-h", "127.0.0.1"]
});

if (!existsSync(resolve(databaseDir, "PG_VERSION"))) await pg.initialise();
await pg.start();
const client = pg.getPgClient();
await client.connect();
try {
  for (const name of ["teampulse", "teampulse_test"]) {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!exists.rowCount) await client.query(`CREATE DATABASE "${name}"`);
  }
} finally {
  await client.end();
}
console.info("Local PostgreSQL ready on 127.0.0.1:55432. Development-only credentials are in .env.example.");
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", () => { void stop(); });
process.on("SIGTERM", () => { void stop(); });
setInterval(() => {}, 60_000);
