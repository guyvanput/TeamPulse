import { beforeAll, afterAll, expect, it } from "vitest";
import {
  createFacilitatedSession, createSession, createTopic, createAction, changeCollection, startVoting, finalizeVoting,
  generateMeetingSummary, listSessionHistory, UserError
} from "../../src/lib/service";
import { db as serviceDb } from "../../src/lib/db";
import { fixture, cleanFixture, testDatabase } from "../support/database";
import { HISTORY_PAGE_SIZE, encodeHistoryCursor } from "../../src/lib/session-history";
import type { HistoryPage } from "../../src/lib/session-history";

const db = testDatabase();
let data: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { data = await fixture(db); });
afterAll(async () => { if (data) await cleanFixture(db, data); await db.$disconnect(); await serviceDb.$disconnect(); });

const page = (filter: "ALL" | "IN_PROGRESS" | "CLOSED" = "ALL", cursor?: string, teamId = data.alpha.id, actor = data.alice.id) =>
  listSessionHistory(actor, { teamId, filter, cursor });
const bulk = async (teamId: string, count: number, label: string, patch: object = {}, createdAt = new Date("2020-01-01T00:00:00.000Z")) => {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const row = await db.teamSession.create({ data: {
      teamId, title: `${label} ${i}`, kind: "FACILITATED", facilitatorId: data.alice.id, collectionState: "COLLECTING",
      createdAt: new Date(createdAt.getTime() + i * 1000), ...patch
    } });
    ids.push(row.id);
  }
  return ids;
};

it("SH1/5/7: rows expose lifecycle, facilitator, active topics, open actions and a summary flag without report text", async () => {
  const collecting = await createFacilitatedSession(data.alice.id, { teamId: data.alpha.id, title: "History collecting" });
  await createTopic(data.alice.id, { sessionId: collecting.id, title: "Counted topic", description: "ctx" });
  const removed = await createTopic(data.alice.id, { sessionId: collecting.id, title: "Removed topic", description: "" });
  await db.topic.update({ where: { id: removed.id }, data: { removedAt: new Date(), removedById: data.alice.id } });
  const voting = await createFacilitatedSession(data.alice.id, { teamId: data.alpha.id, title: "History voting" });
  await createTopic(data.alice.id, { sessionId: voting.id, title: "Vote topic", description: "" });
  await changeCollection(data.alice.id, { sessionId: voting.id, state: "PAUSED", version: 0 });
  await startVoting(data.alice.id, { sessionId: voting.id, version: 1 });
  const discussing = await createFacilitatedSession(data.alice.id, { teamId: data.alpha.id, title: "History discussing" });
  await createTopic(data.alice.id, { sessionId: discussing.id, title: "Discuss topic", description: "" });
  await changeCollection(data.alice.id, { sessionId: discussing.id, state: "PAUSED", version: 0 });
  await startVoting(data.alice.id, { sessionId: discussing.id, version: 1 });
  await finalizeVoting(data.alice.id, { sessionId: discussing.id, version: 2 });
  const closedPlain = await createFacilitatedSession(data.alice.id, { teamId: data.alpha.id, title: "History closed no report" });
  await changeCollection(data.alice.id, { sessionId: closedPlain.id, state: "CLOSED", version: 0 });
  const closedSummed = await createFacilitatedSession(data.alice.id, { teamId: data.alpha.id, title: "History closed report" });
  await changeCollection(data.alice.id, { sessionId: closedSummed.id, state: "CLOSED", version: 0 });
  await generateMeetingSummary(data.alice.id, { sessionId: closedSummed.id, version: 1, note: "SECRET WRAP-UP TEXT" });
  const legacy = await createSession(data.alice.id, { teamId: data.alpha.id, title: "History legacy" });
  await createAction(data.alice.id, { sessionId: legacy.id, title: "Legacy open action", context: "", ownerId: data.alice.id, dueDate: "" });
  await createAction(data.alice.id, { sessionId: collecting.id, title: "Facilitated open", context: "", ownerId: data.alice.id, dueDate: "" });
  const done = await createAction(data.alice.id, { sessionId: collecting.id, title: "Facilitated done", context: "", ownerId: data.alice.id, dueDate: "" });
  await db.action.update({ where: { id: done.id }, data: { status: "DONE" } });

  const result = await page();
  const by = (id: string) => result.rows.find(row => row.id === id)!;
  expect(by(collecting.id)).toMatchObject({ lifecycle: "COLLECTING", kind: "FACILITATED", facilitatorName: data.alice.name, topicCount: 1, openActionCount: 1, summaryAvailable: null });
  expect(by(voting.id)).toMatchObject({ lifecycle: "VOTING", topicCount: 1, openActionCount: 0, summaryAvailable: null });
  expect(by(discussing.id)).toMatchObject({ lifecycle: "DISCUSSING", summaryAvailable: null });
  expect(by(closedPlain.id)).toMatchObject({ lifecycle: "CLOSED", summaryAvailable: false });
  expect(by(closedSummed.id)).toMatchObject({ lifecycle: "CLOSED", summaryAvailable: true });
  expect(by(legacy.id)).toMatchObject({ lifecycle: "ACTION_FOLLOW_UP", kind: "ACTION_FOLLOW_UP", facilitatorName: null, topicCount: null, summaryAvailable: null, openActionCount: 1 });
  const serialized = JSON.stringify(result);
  for (const secret of ["SECRET WRAP-UP TEXT", "Counted topic", "Removed topic", "Legacy open action"]) expect(serialized).not.toContain(secret);
  expect(result.rows.every(row => row.createdAt.endsWith("Z"))).toBe(true);
});

it("SH2: non-members, former members, anonymous and unknown teams are indistinguishable and see no rows", async () => {
  const errors: string[] = [];
  const attempts: [string, string][] = [
    [data.bob.id, data.alpha.id], ["", data.alpha.id], [data.alice.id, "00000000-0000-4000-8000-000000000000"], [data.alice.id, data.beta.id]
  ];
  for (const [actor, team] of attempts) {
    const error = await page("ALL", undefined, team, actor).catch(e => e);
    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).kind).toBe("denied");
    errors.push((error as UserError).message);
  }
  expect(new Set(errors).size).toBe(1);
  const carol = await db.user.create({ data: { name: `Carol ${data.alice.id}` } });
  try {
    await db.membership.create({ data: { teamId: data.alpha.id, userId: carol.id } });
    expect((await page("ALL", undefined, data.alpha.id, carol.id)).rows.length).toBeGreaterThan(0);
    await db.membership.delete({ where: { teamId_userId: { teamId: data.alpha.id, userId: carol.id } } });
    const former = await page("ALL", undefined, data.alpha.id, carol.id).catch(e => e);
    expect((former as UserError).message).toBe(errors[0]);
  } finally {
    await db.membership.deleteMany({ where: { userId: carol.id } });
    await db.user.delete({ where: { id: carol.id } });
  }
  const betaOwn = await db.teamSession.create({ data: { teamId: data.beta.id, title: "Beta only", kind: "FACILITATED", collectionState: "COLLECTING", facilitatorId: data.bob.id } });
  expect((await page()).rows.map(row => row.id)).not.toContain(betaOwn.id);
});

it("SH2: a removed participant who is still a team member reads the same rows", async () => {
  const carol = await db.user.create({ data: { name: `Dave ${data.alice.id}` } });
  try {
    await db.membership.create({ data: { teamId: data.alpha.id, userId: carol.id } });
    const session = await createFacilitatedSession(data.alice.id, { teamId: data.alpha.id, title: "Removed reader" });
    await db.sessionParticipant.create({ data: { teamId: data.alpha.id, sessionId: session.id, userId: carol.id, removedAt: new Date() } });
    const own = await page();
    const theirs = await page("ALL", undefined, data.alpha.id, carol.id);
    expect(theirs.rows.map(row => row.id)).toEqual(own.rows.map(row => row.id));
  } finally {
    await db.sessionParticipant.deleteMany({ where: { teamId: data.alpha.id, session: { title: "Removed reader" } } });
    await db.sessionAdministrationEvent.deleteMany({ where: { teamId: data.alpha.id } });
    await db.teamSession.deleteMany({ where: { teamId: data.alpha.id, title: "Removed reader" } });
    await db.membership.deleteMany({ where: { userId: carol.id } });
    await db.user.delete({ where: { id: carol.id } });
  }
});

it("SH3: keyset pages of 20 never skip or repeat, including identical timestamps and concurrent creates", async () => {
  const team = await db.team.create({ data: { name: `Paged ${data.alice.id}`, memberships: { create: { userId: data.alice.id } } } });
  try {
    const same = new Date("2021-03-03T03:03:03.000Z");
    const first = await bulk(team.id, 12, "Distinct");
    const ties: string[] = [];
    for (let i = 0; i < 13; i++) ties.push((await db.teamSession.create({ data: { teamId: team.id, title: `Tie ${i}`, kind: "FACILITATED", facilitatorId: data.alice.id, collectionState: "COLLECTING", createdAt: same } })).id);
    const expected = [...first, ...ties];
    let late = "";
    const pages = await (async () => {
      const out: HistoryPage[] = [];
      let cursor: string | undefined;
      do {
        if (out.length === 1) late = (await db.teamSession.create({ data: { teamId: team.id, title: "Late arrival", kind: "FACILITATED", facilitatorId: data.alice.id, collectionState: "COLLECTING" } })).id;
        const next = await listSessionHistory(data.alice.id, { teamId: team.id, filter: "ALL", cursor });
        out.push(next);
        cursor = next.nextCursor ?? undefined;
      } while (cursor);
      return out;
    })();
    expect(pages.map(p => p.rows.length)).toEqual([HISTORY_PAGE_SIZE, 5]);
    const ids = pages.flatMap(p => p.rows.map(row => row.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...expected].sort());
    expect(ids).not.toContain(late);
    const refreshed = await listSessionHistory(data.alice.id, { teamId: team.id, filter: "ALL" });
    expect(refreshed.rows[0].id).toBe(late);
    expect(pages[1].nextCursor).toBeNull();
    const exact = await db.team.create({ data: { name: `Exact ${data.alice.id}`, memberships: { create: { userId: data.alice.id } } } });
    await bulk(exact.id, HISTORY_PAGE_SIZE, "Exact");
    const single = await listSessionHistory(data.alice.id, { teamId: exact.id, filter: "ALL" });
    expect(single.rows).toHaveLength(HISTORY_PAGE_SIZE);
    expect(single.nextCursor).toBeNull();
    await db.teamSession.deleteMany({ where: { teamId: exact.id } });
    await db.membership.deleteMany({ where: { teamId: exact.id } });
    await db.team.delete({ where: { id: exact.id } });
  } finally {
    await db.teamSession.deleteMany({ where: { teamId: team.id } });
    await db.membership.deleteMany({ where: { teamId: team.id } });
    await db.team.delete({ where: { id: team.id } });
  }
});

it("SH4: lifecycle filters return only matching rows and keep paging", async () => {
  const team = await db.team.create({ data: { name: `Filtered ${data.alice.id}`, memberships: { create: { userId: data.alice.id } } } });
  try {
    const closed = await bulk(team.id, 22, "Closed", { collectionState: "CLOSED", closedAt: new Date() }, new Date("2022-01-01T00:00:00.000Z"));
    const paused = await bulk(team.id, 2, "Paused", { collectionState: "PAUSED" }, new Date("2023-01-01T00:00:00.000Z"));
    const voting = await bulk(team.id, 1, "Voting", { collectionState: "PAUSED", votingState: "OPEN", votingStartedAt: new Date() }, new Date("2023-02-01T00:00:00.000Z"));
    const legacy = await db.teamSession.create({ data: { teamId: team.id, title: "Legacy", kind: "ACTION_FOLLOW_UP", createdAt: new Date("2023-03-01T00:00:00.000Z") } });
    const run = async (filter: "ALL" | "IN_PROGRESS" | "CLOSED") => {
      const out: HistoryPage[] = []; let cursor: string | undefined;
      do { const next = await listSessionHistory(data.alice.id, { teamId: team.id, filter, cursor }); out.push(next); cursor = next.nextCursor ?? undefined; } while (cursor);
      return out;
    };
    const closedPages = await run("CLOSED");
    expect(closedPages.map(p => p.rows.length)).toEqual([20, 2]);
    expect(closedPages.flatMap(p => p.rows).every(row => row.lifecycle === "CLOSED")).toBe(true);
    expect(closedPages.flatMap(p => p.rows.map(row => row.id)).sort()).toEqual([...closed].sort());
    const progress = (await run("IN_PROGRESS")).flatMap(p => p.rows.map(row => row.id)).sort();
    expect(progress).toEqual([...paused, ...voting].sort());
    expect(progress).not.toContain(legacy.id);
    const all = (await run("ALL")).flatMap(p => p.rows.map(row => row.id));
    expect(all).toHaveLength(26);
    expect(all).toContain(legacy.id);
    expect((await run("IN_PROGRESS"))[0].filter).toBe("IN_PROGRESS");
    const empty = await db.team.create({ data: { name: `Empty ${data.alice.id}`, memberships: { create: { userId: data.alice.id } } } });
    expect(await listSessionHistory(data.alice.id, { teamId: empty.id, filter: "CLOSED" })).toEqual({ filter: "CLOSED", rows: [], nextCursor: null });
    await db.membership.deleteMany({ where: { teamId: empty.id } });
    await db.team.delete({ where: { id: empty.id } });
  } finally {
    await db.teamSession.deleteMany({ where: { teamId: team.id } });
    await db.membership.deleteMany({ where: { teamId: team.id } });
    await db.team.delete({ where: { id: team.id } });
  }
});

it("SH6/8: invalid input is a validation error, never another page; reads write nothing", async () => {
  const bad = async (input: unknown) => ((await listSessionHistory(data.alice.id, input).catch(e => e)) as UserError);
  expect((await bad({ teamId: data.alpha.id, filter: "SEARCH" })).kind).toBe("validation");
  expect((await bad({ teamId: data.alpha.id, filter: "ALL", cursor: "garbage!" })).kind).toBe("validation");
  expect((await bad({ teamId: data.alpha.id, filter: "ALL", cursor: Buffer.from("{}").toString("base64url") })).kind).toBe("validation");
  expect((await bad({ teamId: data.alpha.id, extra: true })).kind).toBe("validation");
  const defaulted = await listSessionHistory(data.alice.id, { teamId: data.alpha.id });
  expect(defaulted.filter).toBe("ALL");
  const foreign = encodeHistoryCursor({ createdAt: new Date(0), id: "00000000-0000-4000-8000-000000000000" });
  expect((await listSessionHistory(data.alice.id, { teamId: data.alpha.id, filter: "ALL", cursor: foreign })).rows).toEqual([]);

  const tables = ["teamSession", "topic", "action", "sessionSummary", "sessionParticipant", "membership", "topicVote"] as const;
  const counts = async () => Promise.all(tables.map(table => (db[table] as unknown as { count(): Promise<number> }).count()));
  const before = await counts();
  const sessionsBefore = await db.teamSession.findMany({ where: { teamId: data.alpha.id }, orderBy: { id: "asc" } });
  await page(); await page("CLOSED"); await page("IN_PROGRESS");
  expect(await counts()).toEqual(before);
  expect(await db.teamSession.findMany({ where: { teamId: data.alpha.id }, orderBy: { id: "asc" } })).toEqual(sessionsBefore);
});

it("SH3: the page query can use the existing team/time/id index", async () => {
  const plan = await db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
    await tx.$executeRawUnsafe("SET LOCAL enable_sort = off");
    return tx.$queryRaw<{ "QUERY PLAN": string }[]>`
      EXPLAIN SELECT "id" FROM "TeamSession" WHERE "teamId" = ${data.alpha.id}
      AND ("createdAt", "id") < (now(), 'ffffffff-ffff-4fff-8fff-ffffffffffff')
      ORDER BY "createdAt" DESC, "id" DESC LIMIT 21`;
  });
  expect(plan.map(row => row["QUERY PLAN"]).join("\n")).toContain("TeamSession_teamId_createdAt_id_idx");
});
