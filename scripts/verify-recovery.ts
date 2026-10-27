import { randomBytes, randomUUID, createHash } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium, expect } from "@playwright/test";
import { databaseClient } from "../src/lib/client";
import { testDatabase } from "../tests/support/database";

const guarded = testDatabase();
await guarded.$disconnect();
const base = new URL(process.env.TEST_DATABASE_URL!);
if (!["localhost", "127.0.0.1"].includes(base.hostname)) {
  throw new Error("Archive recovery drills require a local isolated test PostgreSQL server.");
}
const run = randomUUID().replaceAll("-", "");
const names = [`recovery_source_${run}_test`, `recovery_target_${run}_test`];
const created: string[] = [];
const admin = new pg.Pool({ connectionString: base.href, max: 1 });
const directory = resolve(".local", "recovery", run);
const archive = join(directory, "synthetic.dump");
let server: ChildProcess | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const startedAt = new Date();
const prisma = resolve("node_modules", "prisma", "build", "index.js");
const clients: ReturnType<typeof databaseClient>[] = [];
let evidence: Record<string, unknown> | undefined;

function command(file: string, args: string[], env: NodeJS.ProcessEnv, label: string) {
  const result = spawnSync(file, args, { env, stdio: "pipe" });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status}). Output withheld because database tooling may include credentials.`);
}
function databaseUrl(name: string) {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.href;
}
function postgresEnv(name: string) {
  return {
    ...process.env, PGHOST: base.hostname, PGPORT: base.port || "5432",
    PGUSER: decodeURIComponent(base.username), PGPASSWORD: decodeURIComponent(base.password),
    PGDATABASE: name, PGCONNECT_TIMEOUT: "15"
  };
}
async function contents(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const tables = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
    );
    const result: Record<string, unknown[]> = {};
    for (const { table_name: table } of tables.rows) {
      const quoted = `"${table.replaceAll('"', '""')}"`;
      result[table] = (await pool.query(`SELECT row_to_json(t) AS row FROM ${quoted} t ORDER BY row_to_json(t)::text`)).rows.map(item => item.row);
    }
    return result;
  } finally {
    await pool.end();
  }
}

try {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const name of names) {
    await admin.query(`CREATE DATABASE "${name}"`);
    created.push(name);
  }
  const [sourceUrl, targetUrl] = names.map(databaseUrl);
  command(process.execPath, [prisma, "migrate", "deploy"], {
    ...process.env, DATABASE_URL: sourceUrl, DATABASE_URL_UNPOOLED: sourceUrl
  }, "Source migrations");
  const source = databaseClient(sourceUrl);
  clients.push(source);
  const user = await source.user.create({ data: { name: "Synthetic recovery member" } });
  const team = await source.team.create({ data: {
    name: "Synthetic recovery team", memberships: { create: { userId: user.id } }
  } });
  const first = await source.teamSession.create({ data: {
    teamId: team.id, title: "Recovery source session", createdAt: new Date("2026-10-25T10:00:00Z")
  } });
  const later = await source.teamSession.create({ data: {
    teamId: team.id, title: "Recovery progress session", createdAt: new Date("2026-10-26T10:00:00Z")
  } });
  const action = await source.action.create({ data: {
    teamId: team.id, sourceSessionId: first.id, ownerId: user.id,
    title: "Recover owned commitment", context: "Original synthetic recovery context",
    dueDate: new Date("2026-11-01T00:00:00Z"), status: "IN_PROGRESS"
  } });
  await source.actionReview.create({ data: {
    teamId: team.id, actionId: action.id, reviewSessionId: later.id, actorId: user.id,
    note: "Original synthetic progress note", resultingStatus: "IN_PROGRESS"
  } });
  const expected = await contents(sourceUrl);
  const binary = (name: string) => process.env.PG_BIN
    ? join(process.env.PG_BIN, process.platform === "win32" ? `${name}.exe` : name)
    : name;
  command(binary("pg_dump"), ["--format=custom", "--no-owner", "--no-acl", "--file", archive],
    postgresEnv(names[0]), "Archive backup");
  const checksum = createHash("sha256").update(await readFile(archive)).digest("hex");
  await source.actionReview.deleteMany();
  await source.action.update({ where: { id: action.id }, data: { title: "Changed after backup", status: "DONE" } });
  assert.notDeepEqual(await contents(sourceUrl), expected);
  const restoreStarted = Date.now();
  command(binary("pg_restore"), ["--exit-on-error", "--no-owner", "--no-acl", "--dbname", names[1], archive],
    postgresEnv(names[1]), "Archive restore");
  assert.deepEqual(await contents(targetUrl), expected);
  const restoreSeconds = Math.ceil((Date.now() - restoreStarted) / 1000);
  const target = databaseClient(targetUrl);
  clients.push(target);
  const sessionToken = randomBytes(32).toString("hex");
  await target.session.create({ data: { userId: user.id, sessionToken, expires: new Date(Date.now() + 3_600_000) } });
  server = spawn(process.execPath, [resolve("scripts", "start.mjs"), "--port", "3102"], {
    env: {
      ...process.env, DATABASE_URL: targetUrl, DATABASE_URL_UNPOOLED: targetUrl,
      AUTH_SECRET: randomBytes(32).toString("hex"), AUTH_TRUST_HOST: "true",
      AUTH_URL: "http://127.0.0.1:3102"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverError: Error | undefined;
  server.on("error", error => { serverError = error; });
  server.stdout?.resume();
  server.stderr?.resume();
  await expect.poll(async () => {
    if (serverError) throw new Error("Isolated recovery app could not start.");
    if (server?.exitCode !== null) throw new Error("Isolated recovery app exited before readiness.");
    try { return (await fetch("http://127.0.0.1:3102/api/health")).status; }
    catch (error) {
      if (error instanceof TypeError) return 0;
      throw error;
    }
  }, { timeout: 60_000 }).toBe(200);
  browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies([{
    name: "authjs.session-token", value: sessionToken, domain: "127.0.0.1",
    path: "/", httpOnly: true, sameSite: "Lax"
  }]);
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:3102/actions/${action.id}`);
  await expect(page.getByRole("heading", { name: action.title })).toBeVisible();
  await expect(page.getByText(action.context)).toBeVisible();
  await expect(page.getByText("Original synthetic progress note")).toBeVisible();
  await expect(page.getByText("Due: 2026-11-01")).toBeVisible();
  await page.goto("http://127.0.0.1:3102/");
  await page.getByRole("textbox", { name: "Session name" }).fill("Post-restore continuation");
  await page.getByRole("button", { name: "Create session" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Post-restore continuation" })).toBeVisible();
  await expect(page.getByRole("link", { name: action.title })).toBeVisible();
  await page.getByRole("textbox", { name: "Progress note" }).fill("Completed after independent archive recovery");
  await page.getByRole("combobox", { name: "Resulting status" }).selectOption("DONE");
  await page.getByRole("button", { name: "Record review" }).click();
  await expect(page.getByText("No unresolved actions from earlier sessions.")).toBeVisible();
  await page.getByRole("link", { name: action.title }).click();
  await expect(page).toHaveURL(`http://127.0.0.1:3102/actions/${action.id}`);
  await page.reload();
  await expect(page.getByText("Original synthetic progress note")).toBeVisible();
  await expect(page.getByText("Completed after independent archive recovery")).toBeVisible();
  assert.equal((await target.action.findUniqueOrThrow({ where: { id: action.id } })).status, "DONE");
  assert.equal(await target.actionReview.count({ where: { actionId: action.id } }), 2);
  evidence = {
    result: "passed", startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
    archiveSha256: checksum, archiveContains: "synthetic records only; no auth sessions or provider tokens",
    source: names[0], target: names[1], tables: Object.keys(expected),
    restoreSeconds, applicationContinuation: "In progress -> Done; both notes survived reload",
    productionAccess: false,
    retention: "Local synthetic drill archive only; not a production backup policy."
  };
} finally {
  await browser?.close();
  if (server?.pid && server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
  for (const client of clients) await client.$disconnect();
  for (const name of created.reverse()) {
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await admin.end();
}
if (evidence) {
  evidence.databasesRemovedAfterDrill = true;
  await writeFile(join(directory, "evidence.json"), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.info(JSON.stringify(evidence, null, 2));
  console.info(`Synthetic archive and evidence: ${directory}`);
}
