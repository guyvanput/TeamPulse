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
import { snapshotSchema } from "../src/lib/session-snapshot";
import { buildSummaryContent, summaryReportSchema } from "../src/lib/meeting-summary";

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
  const facilitated = await source.teamSession.create({ data: {
    teamId: team.id, title: "Recovered topic collection", kind: "FACILITATED",
    facilitatorId: user.id, collectionState: "COLLECTING",
    participants: { create: { userId: user.id } }
  } });
  await source.topic.createMany({ data: [
    { teamId: team.id, sessionId: facilitated.id, authorId: user.id, title: "Restored active topic", description: "Preserve topic context" },
    { teamId: team.id, sessionId: facilitated.id, authorId: user.id, title: "Restored removed topic", removedAt: new Date(), removedById: user.id, version: 1 }
  ] });
  const voter = await source.user.create({ data: { name: "Synthetic recovery voter" } });
  await source.membership.create({ data: { teamId: team.id, userId: voter.id } });
  async function votingSession(finalized: boolean, topicCount = 3) {
    const voting = await source.teamSession.create({ data: {
      teamId: team.id, title: finalized ? "Recovered final agenda" : "Recovered open voting",
      kind: "FACILITATED", facilitatorId: user.id, collectionState: "PAUSED",
      votingState: finalized ? "FINALIZED" : "OPEN", votingStartedAt: new Date("2026-10-27T10:00:00Z"),
      votingFinalizedAt: finalized ? new Date("2026-10-27T11:00:00Z") : null,
      lifecycleVersion: finalized ? 3 : 2,
      participants: { create: [{ userId: user.id, ballotVersion: 1 }, { userId: voter.id, ballotVersion: 1 }] }
    } });
    const topics: { id: string }[] = [];
    for (let index = 0; index < topicCount; index++) topics.push(await source.topic.create({ data: {
      teamId: team.id, sessionId: voting.id, authorId: user.id,
      title: `Recovered voting topic ${index}`, description: "Preserve voting context",
      createdAt: new Date(`2026-10-27T10:00:0${index}Z`)
    } }));
    await source.topicVote.createMany({ data: [user.id, voter.id].map(userId => ({
      teamId: team.id, sessionId: voting.id, topicId: topics[1].id, userId
    })) });
    if (finalized) await source.agendaEntry.createMany({ data: [1, 0, ...topics.map((_, index) => index).slice(2)].map((index, position) => ({
      teamId: team.id, sessionId: voting.id, topicId: topics[index].id,
      position: position + 1, discussionPosition: position + 1, voteCount: index === 1 ? 2 : 0
    })) });
    return voting;
  }
  const openVoting = await votingSession(false);
  const finalVoting = await votingSession(true);
  const timerSessions: { id: string; label: string }[] = [];
  for (const label of ["running", "paused", "expired", "finished"]) {
    const session = await votingSession(true);
    timerSessions.push({ id: session.id, label });
    const first = await source.agendaEntry.findFirstOrThrow({ where: { sessionId: session.id }, orderBy: { position: "asc" } });
    const now = Date.now();
    await source.topicDiscussion.create({ data: {
      teamId: team.id, sessionId: session.id, topicId: first.topicId,
      state: label === "paused" ? "PAUSED" : label === "finished" ? "FINISHED" : "RUNNING",
      startedAt: new Date(now - 360000), startedById: user.id,
      allocatedMs: label === "running" ? 3900000 : 300000,
      deadlineAt: label === "running" ? new Date(now + 3540000) : label === "expired" ? new Date(now - 60000) : null,
      remainingMs: label === "paused" ? 200001 : label === "finished" ? 0 : null,
      finishedAt: label === "finished" ? new Date(now) : null,
      finishedById: label === "finished" ? user.id : null,
      outcome: label === "finished" ? "DISCUSSED" : null
    } });
  }
  const parking = await votingSession(true);
  const parkingAgenda = await source.agendaEntry.findMany({ where: { sessionId: parking.id }, orderBy: { position: "asc" } });
  const parkedAt = Date.now();
  for (const [topicIndex, attemptNumber, startedAgo, endedAgo, outcome] of [
    [0, 1, 600000, 500000, "DEFERRED"], [0, 2, 400000, 300000, "DEFERRED"],
    [0, 3, 200000, 100000, "DISCUSSED"], [2, 1, 90000, 60000, "DEFERRED"]
  ] as const) {
    await source.topicDiscussion.create({ data: {
      teamId: team.id, sessionId: parking.id, topicId: parkingAgenda[topicIndex].topicId, attemptNumber,
      state: "FINISHED", outcome, deadlineAt: null, remainingMs: 200001, allocatedMs: 300000,
      startedAt: new Date(parkedAt - startedAgo), finishedAt: new Date(parkedAt - endedAgo),
      startedById: user.id, finishedById: user.id
    } });
  }
  for (const [topicIndex, version, kind, attemptNumber, ago] of [
    [0, 4, "PARK", 1, 500000], [0, 5, "RESTORE", null, 450000],
    [0, 6, "PARK", null, 440000], [0, 7, "RESTORE", null, 430000],
    [0, 8, "PARK", 2, 300000], [0, 9, "RESTORE", null, 250000],
    [1, 11, "PARK", null, 95000], [2, 13, "PARK", 1, 60000], [2, 14, "RESTORE", null, 50000]
  ] as const) {
    await source.topicParkingEvent.create({ data: {
      teamId: team.id, sessionId: parking.id, topicId: parkingAgenda[topicIndex].topicId,
      version, kind, attemptNumber, actorId: user.id, createdAt: new Date(parkedAt - ago),
      reason: kind === "PARK" ? `Synthetic deferred reason ${version}` : ""
    } });
  }
  await source.teamSession.update({ where: { id: parking.id }, data: { lifecycleVersion: 14 } });
  const ordered = await votingSession(true, 5);
  const originalOrder = await source.agendaEntry.findMany({ where: { sessionId: ordered.id }, orderBy: { position: "asc" } });
  for (const [index, state, outcome] of [[0, "FINISHED", "DISCUSSED"], [1, "PAUSED", null], [2, "FINISHED", "DEFERRED"]] as const) {
    await source.topicDiscussion.create({ data: {
      teamId: team.id, sessionId: ordered.id, topicId: originalOrder[index].topicId, state, outcome,
      allocatedMs: 300000, remainingMs: 200001, startedAt: new Date(parkedAt - 400000), startedById: user.id,
      finishedAt: state === "FINISHED" ? new Date(parkedAt - 300000) : null,
      finishedById: state === "FINISHED" ? user.id : null
    } });
  }
  for (const [index, version, kind, attemptNumber] of [[2, 4, "PARK", 1], [2, 5, "RESTORE", null], [3, 6, "PARK", null]] as const) {
    await source.topicParkingEvent.create({ data: {
      teamId: team.id, sessionId: ordered.id, topicId: originalOrder[index].topicId, version, kind, attemptNumber,
      actorId: user.id, createdAt: new Date(parkedAt - 300000 + (version - 4) * 10000), reason: kind === "PARK" ? "Retain planned place" : ""
    } });
  }
  const futureIds = originalOrder.slice(2).map(item => item.topicId);
  const reordered = [futureIds[0], futureIds[2], futureIds[1]];
  const beforeLast = [futureIds[2], futureIds[0], futureIds[1]];
  for (const [version, topicId, neighborTopicId, direction, beforeQueue, afterQueue] of [
    [7, futureIds[2], futureIds[1], "EARLIER", futureIds, reordered],
    [8, futureIds[2], futureIds[1], "LATER", reordered, futureIds],
    [9, futureIds[2], futureIds[1], "EARLIER", futureIds, reordered],
    [10, futureIds[2], futureIds[0], "EARLIER", reordered, beforeLast]
  ] as const) await source.agendaOrderChange.create({ data: {
    teamId: team.id, sessionId: ordered.id, actorId: user.id, createdAt: new Date(parkedAt - 200000 + version * 1000),
    version, topicId, neighborTopicId, direction, beforeQueue, afterQueue
  } });
  await source.$transaction(async tx => {
    await tx.$executeRaw`SET CONSTRAINTS "AgendaEntry_sessionId_discussionPosition_key" DEFERRED`;
    for (const [index, position] of [[2, 4], [3, 5], [4, 3]]) {
      await tx.agendaEntry.update({ where: { sessionId_topicId: { sessionId: ordered.id, topicId: originalOrder[index].topicId } },
        data: { discussionPosition: position } });
    }
    await tx.teamSession.update({ where: { id: ordered.id }, data: { lifecycleVersion: 10 } });
  });
  const orderRows = await source.agendaOrderChange.findMany({ orderBy: { version: "asc" } });
  const orderEntries = await source.agendaEntry.findMany({ where: { sessionId: ordered.id }, orderBy: { position: "asc" } });
  const summarized = await votingSession(true);
  const summaryAgenda = await source.agendaEntry.findMany({ where: { sessionId: summarized.id }, orderBy: { position: "asc" } });
  for (const [index, outcome] of [[0, "DISCUSSED"], [2, "DEFERRED"]] as const) {
    await source.topicDiscussion.create({ data: {
      teamId: team.id, sessionId: summarized.id, topicId: summaryAgenda[index].topicId, state: "FINISHED", outcome,
      allocatedMs: 300000, remainingMs: 200001, startedAt: new Date(parkedAt - 400000), startedById: user.id,
      finishedAt: new Date(parkedAt - 300000), finishedById: user.id
    } });
  }
  for (const [index, version, kind, attemptNumber] of [[1, 4, "PARK", null], [2, 5, "PARK", 1], [2, 6, "RESTORE", null]] as const) {
    await source.topicParkingEvent.create({ data: {
      teamId: team.id, sessionId: summarized.id, topicId: summaryAgenda[index].topicId, version, kind, attemptNumber,
      actorId: user.id, createdAt: new Date(parkedAt - 300000 + version * 1000), reason: kind === "PARK" ? "Captured parked reason" : ""
    } });
  }
  await source.$transaction(async tx => {
    await tx.$executeRaw`SET CONSTRAINTS "AgendaEntry_sessionId_discussionPosition_key" DEFERRED`;
    for (const [index, position] of [[1, 3], [2, 2]]) {
      await tx.agendaEntry.update({ where: { sessionId_topicId: { sessionId: summarized.id, topicId: summaryAgenda[index].topicId } },
        data: { discussionPosition: position } });
    }
    await tx.agendaOrderChange.create({ data: {
      teamId: team.id, sessionId: summarized.id, version: 7, actorId: user.id, createdAt: new Date(parkedAt - 200000),
      topicId: summaryAgenda[2].topicId, neighborTopicId: summaryAgenda[1].topicId, direction: "EARLIER",
      beforeQueue: summaryAgenda.slice(1).map(item => item.topicId), afterQueue: summaryAgenda.slice(1).reverse().map(item => item.topicId)
    } });
    await tx.teamSession.update({ where: { id: summarized.id }, data: {
      title: "Recovered immutable summary", collectionState: "CLOSED", lifecycleVersion: 8, closedAt: new Date()
    } });
  });
  const summaryReview = await source.actionReview.create({ data: {
    teamId: team.id, actionId: action.id, reviewSessionId: summarized.id, actorId: user.id,
    note: "Progress captured in immutable summary", resultingStatus: "IN_PROGRESS"
  } });
  const capturedPerson = { id: user.id, name: user.name ?? "Team member" };
  const content = buildSummaryContent({
    session: { id: summarized.id, title: "Recovered immutable summary", facilitator: capturedPerson, state: "CLOSED", votingState: "FINALIZED" },
    participants: (await source.sessionParticipant.findMany({ where: { sessionId: summarized.id },
      include: { user: { select: { id: true, name: true } } }, orderBy: [{ joinedAt: "asc" }, { userId: "asc" }] }))
      .map(item => ({ id: item.userId, name: item.user.name ?? "Team member", joinedAt: item.joinedAt.toISOString() })),
    topics: (await source.topic.findMany({ where: { sessionId: summarized.id } }))
      .map(item => ({ id: item.id, title: item.title, description: item.description, removedAt: item.removedAt?.toISOString() ?? null })),
    agenda: await source.agendaEntry.findMany({ where: { sessionId: summarized.id }, orderBy: { position: "asc" } }),
    attempts: await source.topicDiscussion.findMany({ where: { sessionId: summarized.id } }),
    events: await source.topicParkingEvent.findMany({ where: { sessionId: summarized.id } }),
    actions: [{
      id: action.id, title: action.title, context: action.context, owner: capturedPerson, status: action.status,
      dueDate: "2026-11-01", source: { id: first.id, title: first.title }, createdHere: false,
      reviews: [{ id: summaryReview.id, actor: capturedPerson, createdAt: summaryReview.createdAt.toISOString(),
        note: summaryReview.note, resultingStatus: summaryReview.resultingStatus }]
    }]
  });
  const summaryRow = await source.sessionSummary.create({ data: {
    teamId: team.id, sessionId: summarized.id, generatedById: user.id, generatedByName: capturedPerson.name,
    generatedAt: new Date(), formatVersion: 1, note: "Synthetic facilitator wrap-up; retained permanently.", content
  } });
  const capturedReport = summaryReportSchema.parse({
    formatVersion: summaryRow.formatVersion, generatedAt: summaryRow.generatedAt.toISOString(), generatedBy: capturedPerson,
    note: summaryRow.note, content: summaryRow.content
  });
  const administered = await votingSession(true);
  const removedUser = await source.user.create({ data: { name: "Synthetic removed participant" } });
  await source.membership.create({ data: { teamId: team.id, userId: removedUser.id } });
  const removedParticipant = await source.sessionParticipant.create({ data: {
    teamId: team.id, sessionId: administered.id, userId: removedUser.id,
    joinedAt: new Date("2026-10-27T09:00:00Z"), ballotVersion: 2, removedAt: new Date("2026-10-27T12:03:00Z")
  } });
  const managedAgenda = await source.agendaEntry.findMany({ where: { sessionId: administered.id }, orderBy: { position: "asc" } });
  await source.topicVote.createMany({ data: managedAgenda.slice(0, 2).map(entry => ({
    teamId: team.id, sessionId: administered.id, userId: removedUser.id, topicId: entry.topicId
  })) });
  await source.agendaEntry.updateMany({ where: { sessionId: administered.id, position: { lte: 2 } }, data: { voteCount: { increment: 1 } } });
  await source.topicDiscussion.create({ data: {
    teamId: team.id, sessionId: administered.id, topicId: managedAgenda[0].topicId, state: "RUNNING",
    allocatedMs: 3900000, startedAt: new Date(), startedById: user.id, deadlineAt: new Date(Date.now() + 3900000)
  } });
  for (const [version, kind, actorId, targetId] of [
    [4, "TRANSFER", user.id, voter.id], [5, "REMOVE", voter.id, removedUser.id],
    [6, "READMIT", voter.id, removedUser.id], [7, "REMOVE", voter.id, removedUser.id]
  ] as const) await source.sessionAdministrationEvent.create({ data: {
    teamId: team.id, sessionId: administered.id, version, kind, actorId, targetId,
    createdAt: new Date(`2026-10-27T12:0${version - 4}:00Z`), reason: kind === "REMOVE" ? "Synthetic temporary removal" : ""
  } });
  await source.teamSession.update({ where: { id: administered.id }, data: { facilitatorId: voter.id, lifecycleVersion: 7 } });
  const administrationRows = await source.sessionAdministrationEvent.findMany({ where: { sessionId: administered.id }, orderBy: { version: "asc" } });
  const retainedVotes = await source.topicVote.findMany({ where: { sessionId: administered.id }, orderBy: [{ userId: "asc" }, { topicId: "asc" }] });
  const discussionOrder = [{ sessionId: "asc" }, { topicId: "asc" }, { attemptNumber: "asc" }] as const;
  const timerRows = await source.topicDiscussion.findMany({ orderBy: [...discussionOrder] });
  const parkingOrder = [{ sessionId: "asc" }, { version: "asc" }] as const;
  const parkingRows = await source.topicParkingEvent.findMany({ orderBy: [...parkingOrder] });
  const expected = await contents(sourceUrl);
  assert.equal(Object.keys(expected).length, 19);
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
  const appEnv = {
    ...process.env, DATABASE_URL: targetUrl, DATABASE_URL_UNPOOLED: targetUrl,
    AUTH_SECRET: randomBytes(32).toString("hex"), AUTH_TRUST_HOST: "true",
    AUTH_URL: "http://127.0.0.1:3102"
  };
  let serverError: Error | undefined;
  async function startApp() {
    serverError = undefined;
    server = spawn(process.execPath, [resolve("scripts", "start.mjs"), "--port", "3102"], {
      env: appEnv, stdio: ["ignore", "pipe", "pipe"]
    });
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
  }
  await startApp();
  browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies([{
    name: "authjs.session-token", value: sessionToken, domain: "127.0.0.1",
    path: "/", httpOnly: true, sameSite: "Lax"
  }]);
  const page = await context.newPage();
  const facilitatorContext = await browser.newContext();
  const removedContext = await browser.newContext();
  for (const [identityContext, userId] of [[facilitatorContext, voter.id], [removedContext, removedUser.id]] as const) {
    const token = randomBytes(32).toString("hex");
    await target.session.create({ data: { userId, sessionToken: token, expires: new Date(Date.now() + 3600000) } });
    await identityContext.addCookies([{ name: "authjs.session-token", value: token, domain: "127.0.0.1",
      path: "/", httpOnly: true, sameSite: "Lax" }]);
  }
  const facilitatorPage = await facilitatorContext.newPage();
  const removedPage = await removedContext.newPage();
  async function verifyAdministration(readmitted: boolean) {
    const address = `http://127.0.0.1:3102/sessions/${administered.id}`;
    await page.goto(address);
    await facilitatorPage.goto(address);
    await removedPage.goto(address);
    const read = async (viewer: typeof page) => snapshotSchema.parse(await (await viewer.request.get(
      `http://127.0.0.1:3102/api/sessions/${administered.id}/snapshot`)).json());
    const old = await read(page), current = await read(facilitatorPage), removed = await read(removedPage);
    assert.equal(old.facilitatorView, false);
    assert.equal(old.joined, true);
    assert.equal(old.administration.canAdminister, false);
    assert.equal(current.facilitatorView, true);
    assert.equal(current.administration.canAdminister, true);
    assert.equal(removed.administration.viewerState, readmitted ? "ACTIVE" : "REMOVED");
    assert.equal(removed.administration.canJoin, false);
    assert.equal(removed.voting.remaining, 1);
    assert.equal(removed.voting.ballotVersion, 2);
    assert.equal(removed.voting.selectedTopicIds.length, 2);
    await expect(page.getByRole("button", { name: "Pause timer", exact: true })).toHaveCount(0);
    await expect(facilitatorPage.getByRole("button", { name: "Pause timer", exact: true })).toBeEnabled();
    await expect(removedPage.getByRole("button", { name: "Join session", exact: true })).toHaveCount(0);
    await expect(removedPage.getByRole("button", { name: "Pause timer", exact: true })).toHaveCount(0);
    assert.deepEqual(await target.topicVote.findMany({ where: { sessionId: administered.id }, orderBy: [{ userId: "asc" }, { topicId: "asc" }] }), retainedVotes);
    assert.deepEqual(await target.sessionParticipant.findUniqueOrThrow({ where: {
      sessionId_userId: { sessionId: administered.id, userId: removedUser.id }
    } }), { ...removedParticipant, removedAt: readmitted ? null : removedParticipant.removedAt });
    const history = await target.sessionAdministrationEvent.findMany({ where: { sessionId: administered.id }, orderBy: { version: "asc" } });
    assert.deepEqual(history.slice(0, 4), administrationRows);
    assert.equal(history.length, readmitted ? 5 : 4);
    assert.deepEqual(await target.topicDiscussion.findMany({ orderBy: [...discussionOrder] }), timerRows);
    assert.deepEqual(await target.sessionSummary.findUniqueOrThrow({ where: { sessionId: summarized.id } }), summaryRow);
  }
  async function verifyDiscussions() {
    for (const session of timerSessions) {
      await page.goto(`http://127.0.0.1:3102/sessions/${session.id}`);
      if (session.label === "finished") {
        await expect(page.getByRole("list", { name: "Discussion progress" }).getByRole("listitem").first()).toContainText("Discussed");
        await expect(page.getByRole("button", { name: "Start next topic" })).toBeEnabled();
      } else {
        await expect(page.getByText(`Discussion: ${session.label === "running" ? "Running" : session.label === "paused" ? "Paused" : "Time expired"}`, { exact: true })).toBeVisible();
        await expect(page.getByRole("timer")).toBeVisible();
        if (session.label === "paused") await expect(page.getByRole("timer")).toHaveText("3:21");
        if (session.label === "expired") await expect(page.getByRole("timer")).toHaveText("0:00");
      }
    }
    await page.goto(`http://127.0.0.1:3102/sessions/${parking.id}`);
    await expect(page.getByRole("list", { name: "Parked topics", exact: true })).toContainText("Synthetic deferred reason 11");
    const progress = page.getByRole("list", { name: "Discussion progress" }).getByRole("listitem");
    await expect(progress.nth(0)).toContainText("Attempt 1: Deferred");
    await expect(progress.nth(0)).toContainText("Attempt 2: Deferred");
    await expect(progress.nth(0)).toContainText("Attempt 3: Discussed");
    await expect(progress.nth(2)).toContainText("Not discussed");
    await expect(progress.nth(2)).toContainText("Attempt 1: Deferred");
    await expect(page.getByText("Next: Recovered voting topic 2", { exact: true })).toBeVisible();
    await expect(page.getByRole("list", { name: "Parking history for Recovered voting topic 1", exact: true }).getByRole("listitem")).toHaveCount(6);
    await page.goto(`http://127.0.0.1:3102/sessions/${ordered.id}`);
    await expect(page.getByRole("heading", { name: "Current: Recovered voting topic 0", exact: true })).toBeVisible();
    await expect(page.getByRole("timer")).toHaveText("3:21");
    const planned = page.getByRole("list", { name: "Future discussion queue", exact: true }).getByRole("listitem");
    await expect(planned).toHaveText([
      "Recovered voting topic 4 / Plan slot: 3 / Original vote rank: 5 / Votes: 0",
      "Recovered voting topic 2 / Plan slot: 4 / Original vote rank: 3 / Votes: 0",
      "Recovered voting topic 3 / Plan slot: 5 / Original vote rank: 4 / Votes: 0 / Parked"
    ]);
    await expect(page.getByRole("list", { name: "Agenda order history", exact: true }).getByRole("listitem")).toHaveCount(4);
    const snapshot = snapshotSchema.parse(await (await page.request.get(`http://127.0.0.1:3102/api/sessions/${ordered.id}/snapshot`)).json());
    assert.equal(snapshot.discussion.nextTopicId, futureIds[2]);
    assert.deepEqual(snapshot.agendaOrder.future.map(item => item.topicId), beforeLast);
    assert.deepEqual(await target.agendaEntry.findMany({ where: { sessionId: ordered.id }, orderBy: { position: "asc" } }), orderEntries);
    assert.deepEqual(await target.agendaOrderChange.findMany({ where: { sessionId: ordered.id }, orderBy: { version: "asc" } }), orderRows);
    assert.deepEqual(await target.topicDiscussion.findMany({ orderBy: [...discussionOrder] }), timerRows);
    assert.deepEqual(await target.topicParkingEvent.findMany({ orderBy: [...parkingOrder] }), parkingRows);
  }
  async function verifySummary() {
    await page.goto(`http://127.0.0.1:3102/sessions/${summarized.id}#meeting-summary`);
    const report = page.getByRole("region", { name: "Saved meeting summary", exact: true });
    await expect(report).toBeVisible();
    await expect(report.getByText(summaryRow.note, { exact: true })).toBeVisible();
    await expect(report.getByText("Status at generation: In progress", { exact: true })).toBeVisible();
    await expect(report.getByText("Latest parked reason: Captured parked reason", { exact: true })).toBeVisible();
    await expect(report.getByText("Outcome: Discussed", { exact: true })).toBeVisible();
    await expect(report.getByText("Outcome: Not discussed", { exact: true })).toBeVisible();
    await expect(report.getByText("Outcome: Deferred", { exact: true })).toBeVisible();
    const snapshot = snapshotSchema.parse(await (await page.request.get(`http://127.0.0.1:3102/api/sessions/${summarized.id}/snapshot`)).json());
    assert.deepEqual(snapshot.summary.report, capturedReport);
    assert.equal(snapshot.summary.canGenerate, false);
    assert.deepEqual(snapshot.summary.report?.content.topics.map(item => item.discussionPosition), [1, 3, 2]);
    assert.deepEqual(await target.sessionSummary.findUniqueOrThrow({ where: { sessionId: summarized.id } }), summaryRow);
  }
  await verifyDiscussions();
  await verifySummary();
  await verifyAdministration(false);
  await facilitatorPage.getByRole("button", { name: `Readmit ${removedUser.name}`, exact: true }).click();
  await facilitatorPage.getByRole("button", { name: `Confirm readmit ${removedUser.name}`, exact: true }).click();
  await expect(facilitatorPage.getByRole("list", { name: "Administration history", exact: true }).getByRole("listitem")).toHaveCount(5);
  await verifyAdministration(true);
  await page.goto(`http://127.0.0.1:3102/actions/${action.id}`);
  await expect(page.getByRole("heading", { name: action.title })).toBeVisible();
  await expect(page.getByText(action.context)).toBeVisible();
  await expect(page.getByText("Original synthetic progress note")).toBeVisible();
  await expect(page.getByText("Due: 2026-11-01")).toBeVisible();
  await page.goto(`http://127.0.0.1:3102/sessions/${facilitated.id}`);
  await expect(page.getByRole("heading", { name: "Restored active topic", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Restored removed topic", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Topic title", exact: true }).fill("Continued after restore");
  await page.getByRole("button", { name: "Submit topic" }).click();
  await expect(page.getByRole("heading", { name: "Continued after restore" })).toBeVisible();
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
  assert.equal(await target.actionReview.count({ where: { actionId: action.id } }), 3);
  await verifySummary();
  await page.goto(`http://127.0.0.1:3102/sessions/${openVoting.id}`);
  await expect(page.getByText("Votes remaining: 2 of 3", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Provisional agenda" }).getByRole("listitem").first())
    .toHaveText("Recovered voting topic 1 / Votes: 2");
  await page.getByRole("button", { name: "Vote for Recovered voting topic 0", exact: true }).click();
  await expect(page.getByText("Votes remaining: 1 of 3", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Vote for Recovered voting topic 0", exact: true })).toHaveAttribute("aria-pressed", "true");
  assert.equal(await target.topicVote.count({ where: { sessionId: openVoting.id } }), 3);
  const finalEntries = await target.agendaEntry.findMany({ where: { sessionId: finalVoting.id }, orderBy: { position: "asc" } });
  await page.goto(`http://127.0.0.1:3102/sessions/${finalVoting.id}`);
  await expect(page.getByRole("list", { name: "Final agenda" }).getByRole("listitem")).toHaveText([
    "Recovered voting topic 1 / Votes: 2", "Recovered voting topic 0 / Votes: 0", "Recovered voting topic 2 / Votes: 0"
  ]);
  await expect(page.getByRole("button", { name: "Vote for Recovered voting topic 0", exact: true })).toBeDisabled();
  await page.reload();
  assert.deepEqual(await target.agendaEntry.findMany({ where: { sessionId: finalVoting.id }, orderBy: { position: "asc" } }), finalEntries);
  assert.ok(server);
  const exited = once(server, "exit");
  server.kill();
  await exited;
  await startApp();
  await verifyDiscussions();
  await verifySummary();
  await verifyAdministration(true);
  await page.goto(`http://127.0.0.1:3102/sessions/${openVoting.id}`);
  await expect(page.getByText("Votes remaining: 1 of 3", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Vote for Recovered voting topic 0", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.goto(`http://127.0.0.1:3102/sessions/${finalVoting.id}`);
  await expect(page.getByRole("list", { name: "Final agenda" }).getByRole("listitem")).toHaveText([
    "Recovered voting topic 1 / Votes: 2", "Recovered voting topic 0 / Votes: 0", "Recovered voting topic 2 / Votes: 0"
  ]);
  assert.deepEqual(await target.agendaEntry.findMany({ where: { sessionId: finalVoting.id }, orderBy: { position: "asc" } }), finalEntries);
  evidence = {
    result: "passed", startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
    archiveSha256: checksum, archiveContains: "synthetic records only; no auth sessions or provider tokens",
    source: names[0], target: names[1], tables: Object.keys(expected),
    restoreSeconds, applicationContinuation: "Roster/topics/removal history restored; new topic saved; In progress -> Done; both notes survived reload; distinct-user Open ballots continued; Open ballots, Finalized ranks/counts, running/paused/expired/finished discussions and repeated parking/restoration history survived an actual app-process restart. Identical persisted deadlines, paused milliseconds, Deferred/Discussed attempts, reasons and attribution; manually reordered full positions, frozen current/Discussed slots, parked/restored waiting eligibility and four attributed/reverse move histories survived unchanged. Correct planned next topic verified without read-side writes",
    productionAccess: false,
    summaryContinuation: "Exact 19-table restore included one immutable versioned report with captured names/time/wrap-up, Discussed/Deferred/restored Not discussed topics, original/manual positions and generation-time action/review values. Live action progressed from In progress to Done after restore; all report fields remained identical before and after the actual recovered-app process restart.",
    administrationContinuation: "Transferred single facilitator, repeated removal/readmission history, removed user's original join/ballot and two selected votes restored exactly. Old facilitator remained an ordinary participant, removed user could read but not self-join/administer, new facilitator explicitly readmitted them after restore. Five attributed events, original budget, unchanged running clocks and immutable report verified again after actual recovered-app process restart.",
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
