import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  createFacilitatedSession, createSession, createTopic, joinSession, changeCollection,
  startVoting, finalizeVoting, controlDiscussion, createAction, databaseNow
} from "../../src/lib/service";
import { sessionSnapshot } from "../../src/lib/snapshot-service";
import { db as serviceDb } from "../../src/lib/db";
import { fixture, cleanFixture, testDatabase } from "../support/database";
import { queuedSession } from "../support/queued-session";

const db = testDatabase();
let data: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  data = await fixture(db);
  await db.membership.create({ data: { teamId: data.alpha.id, userId: data.bob.id } });
});
afterAll(async () => { if (data) await cleanFixture(db, data); await db.$disconnect(); await serviceDb.$disconnect(); });
async function prepared(actor = data.alice.id) {
  const session = await createFacilitatedSession(actor, { teamId: data.alpha.id, title: "Timed discussion" });
  for (let i = 0; i < 3; i++) await createTopic(actor, { sessionId: session.id, title: `Discussion ${i}`, description: "" });
  await changeCollection(actor, { sessionId: session.id, state: "PAUSED", version: 0 });
  await startVoting(actor, { sessionId: session.id, version: 1 });
  await finalizeVoting(actor, { sessionId: session.id, version: 2 });
  const agenda = await db.agendaEntry.findMany({ where: { sessionId: session.id }, orderBy: { position: "asc" } });
  return { sessionId: session.id, agenda };
}
type Operation = Parameters<typeof controlDiscussion>[2];
const run = (sessionId: string, topicId: string, version: number, operation: Operation, actor?: string) =>
  controlDiscussion(actor === undefined ? data.alice.id : actor, { sessionId, topicId, version }, operation);
const stored = (sessionId: string, topicId: string) => db.topicDiscussion.findUniqueOrThrow({ where: { sessionId_topicId_attemptNumber: { sessionId, topicId, attemptNumber: 1 } } });

describe("TD1-5/7: authorized atomic discussion", () => {
  it("samples an absolute database epoch independently of PostgreSQL session timezone", async () => {
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'America/New_York'`);
      const sample = await databaseNow(tx);
      const [epoch] = await tx.$queryRaw<{ milliseconds: bigint }[]>`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS milliseconds`;
      expect(Number(epoch.milliseconds) - sample.getTime()).toBeGreaterThanOrEqual(0);
      expect(Number(epoch.milliseconds) - sample.getTime()).toBeLessThan(1000);
    });
  });
  it("only starts the next saved rank and retains immutable voting results", async () => {
    const { sessionId, agenda } = await prepared();
    await expect(run(sessionId, agenda[1].topicId, 3, "start")).rejects.toMatchObject({ kind: "conflict" });
    await run(sessionId, agenda[0].topicId, 3, "start");
    const current = await stored(sessionId, agenda[0].topicId);
    expect(current).toMatchObject({ state: "RUNNING", startedById: data.alice.id, allocatedMs: 300000, remainingMs: null });
    expect(current.deadlineAt!.getTime() - current.startedAt.getTime()).toBe(300000);
    await expect(run(sessionId, agenda[1].topicId, 4, "start")).rejects.toMatchObject({ kind: "conflict" });
    await expect(run(sessionId, agenda[0].topicId, 3, "extend")).rejects.toMatchObject({ kind: "conflict" });
    await run(sessionId, agenda[0].topicId, 4, "finish");
    await expect(run(sessionId, agenda[0].topicId, 5, "start")).rejects.toMatchObject({ kind: "conflict" });
    await run(sessionId, agenda[1].topicId, 5, "start");
    expect(await db.agendaEntry.findMany({ where: { sessionId }, orderBy: { position: "asc" } })).toEqual(agenda);
  });
  it("enforces facilitator, team, participation, phase and exact topic identity", async () => {
    const { sessionId, agenda } = await prepared();
    for (const actor of ["", data.bob.id]) {
      await expect(run(sessionId, agenda[0].topicId, 3, "start", actor)).rejects.toMatchObject({ kind: "denied" });
    }
    await joinSession(data.bob.id, { sessionId });
    await expect(run(sessionId, agenda[0].topicId, 3, "start", data.bob.id)).rejects.toMatchObject({ kind: "denied" });
    const foreign = await createFacilitatedSession(data.bob.id, { teamId: data.beta.id, title: "Foreign" });
    await expect(run(foreign.id, agenda[0].topicId, 0, "start")).rejects.toMatchObject({ kind: "denied" });
    const legacy = await createSession(data.alice.id, { teamId: data.alpha.id, title: "Legacy" });
    await expect(run(legacy.id, agenda[0].topicId, 0, "start")).rejects.toMatchObject({ kind: "conflict" });
    const open = await createFacilitatedSession(data.alice.id, { teamId: data.alpha.id, title: "Collecting" });
    await expect(run(open.id, agenda[0].topicId, 0, "start")).rejects.toMatchObject({ kind: "conflict" });
    await run(sessionId, agenda[0].topicId, 3, "start");
    await expect(run(sessionId, agenda[1].topicId, 4, "finish")).rejects.toMatchObject({ kind: "conflict" });
  });
  it("extends running/paused/expired correctly and derives expiry without a write", async () => {
    const { sessionId, agenda } = await prepared();
    const id = agenda[0].topicId;
    await run(sessionId, id, 3, "start");
    const first = await stored(sessionId, id);
    await run(sessionId, id, 4, "extend");
    expect((await stored(sessionId, id)).deadlineAt!.getTime()).toBe(first.deadlineAt!.getTime() + 120000);
    await run(sessionId, id, 5, "pause");
    const paused = await stored(sessionId, id);
    await run(sessionId, id, 6, "extend");
    expect(await stored(sessionId, id)).toMatchObject({ state: "PAUSED", remainingMs: paused.remainingMs! + 120000, allocatedMs: 540000 });
    await run(sessionId, id, 7, "resume");
    await db.topicDiscussion.update({ where: { sessionId_topicId_attemptNumber: { sessionId, topicId: id, attemptNumber: 1 } }, data: { deadlineAt: new Date(Date.now() - 60000) } });
    const before = await stored(sessionId, id);
    expect((await sessionSnapshot(data.alice.id, sessionId)).discussion.current).toMatchObject({ state: "EXPIRED", remainingMs: 0 });
    expect(await stored(sessionId, id)).toEqual(before);
    for (const operation of ["pause", "resume"] as const) await expect(run(sessionId, id, 8, operation)).rejects.toThrow(/extend|finish/i);
    await run(sessionId, id, 8, "extend");
    const resumed = await stored(sessionId, id);
    expect(resumed.deadlineAt!.getTime()).toBeGreaterThan(Date.now() + 115000);
    expect(resumed.allocatedMs).toBe(660000);
  });
  it("requires finishing before close and retains unstarted outcomes and actions", async () => {
    const { sessionId, agenda } = await prepared();
    await run(sessionId, agenda[0].topicId, 3, "start");
    await expect(changeCollection(data.alice.id, { sessionId, state: "CLOSED", version: 4 })).rejects.toThrow(/finish.*discussion/i);
    await createAction(data.alice.id, { sessionId, title: "Captured during discussion", ownerId: data.alice.id, context: "Keep", dueDate: "" });
    await run(sessionId, agenda[0].topicId, 4, "finish");
    expect(await stored(sessionId, agenda[0].topicId)).toMatchObject({ state: "FINISHED", finishedById: data.alice.id, finishedAt: expect.any(Date) });
    await changeCollection(data.alice.id, { sessionId, state: "CLOSED", version: 5 });
    const snapshot = await sessionSnapshot(data.alice.id, sessionId);
    expect(snapshot.discussion.entries.map(item => item.state)).toEqual(["FINISHED", "NOT_STARTED", "NOT_STARTED"]);
    expect(snapshot.actions).toHaveLength(1);
    await expect(run(sessionId, agenda[1].topicId, 6, "start")).rejects.toMatchObject({ kind: "conflict" });
  });
  it.each([null, false, "", [], -1, 0.1])("rejects malformed expected version %j", async version => {
    const { sessionId, agenda } = await prepared();
    await expect(controlDiscussion(data.alice.id, { sessionId, topicId: agenda[0].topicId, version }, "start")).rejects.toMatchObject({ kind: "validation" });
    expect(await db.topicDiscussion.count({ where: { sessionId } })).toBe(0);
  });
  it("rejects oversized revisions and exhausted allocation/version without mutation", async () => {
    const { sessionId, agenda } = await prepared();
    const id = agenda[0].topicId;
    await expect(run(sessionId, id, Number.MAX_SAFE_INTEGER, "start")).rejects.toMatchObject({ kind: "conflict" });
    await run(sessionId, id, 3, "start");
    await db.topicDiscussion.update({ where: { sessionId_topicId_attemptNumber: { sessionId, topicId: id, attemptNumber: 1 } }, data: { allocatedMs: 2147483640 } });
    await expect(run(sessionId, id, 4, "extend")).rejects.toMatchObject({ kind: "conflict" });
    await db.teamSession.update({ where: { id: sessionId }, data: { lifecycleVersion: 2147483647 } });
    await expect(run(sessionId, id, 2147483647, "finish")).rejects.toMatchObject({ kind: "conflict" });
    expect((await stored(sessionId, id)).state).toBe("RUNNING");
  });
  it("serializes simultaneous starts and extensions with no double allocation", async () => {
    const { sessionId, agenda } = await prepared();
    const id = agenda[0].topicId;
    for (const [version, operation] of [[3, "start"], [4, "extend"]] as const) {
      const outcomes = await queuedSession(db, sessionId, [() => run(sessionId, id, version, operation), () => run(sessionId, id, version, operation)]);
      expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter(item => item.status === "rejected")).toHaveLength(1);
    }
    expect((await stored(sessionId, id)).allocatedMs).toBe(420000);
  });
  it("denies a queued command when membership is revoked before its lock", async () => {
    const { sessionId, agenda } = await prepared(data.bob.id);
    try {
      const outcomes = await queuedSession(db, sessionId, [() => run(sessionId, agenda[0].topicId, 3, "start", data.bob.id)], async blocker => {
        await blocker.query(`DELETE FROM "Membership" WHERE "teamId"=$1 AND "userId"=$2`, [data.alpha.id, data.bob.id]);
      });
      expect(outcomes[0]).toMatchObject({ status: "rejected", reason: { kind: "denied" } });
      expect(await db.topicDiscussion.count({ where: { sessionId } })).toBe(0);
    } finally { await db.membership.upsert({
      where: { teamId_userId: { teamId: data.alpha.id, userId: data.bob.id } }, update: {},
      create: { teamId: data.alpha.id, userId: data.bob.id }
    }); }
  });
  it.each([["pause", "extend"], ["finish", "extend"]] as const)("serializes %s versus %s", async (first, second) => {
    const { sessionId, agenda } = await prepared();
    const id = agenda[0].topicId;
    await run(sessionId, id, 3, "start");
    const outcomes = await queuedSession(db, sessionId, [() => run(sessionId, id, 4, first), () => run(sessionId, id, 4, second)]);
    expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(item => item.status === "rejected")).toHaveLength(1);
    expect((await db.teamSession.findUniqueOrThrow({ where: { id: sessionId } })).lifecycleVersion).toBe(5);
    const row = await stored(sessionId, id);
    expect(row.allocatedMs).toBe(row.state === "RUNNING" ? 420000 : 300000);
  });
  it("serializes start versus closure with exactly one authorized result", async () => {
    const { sessionId, agenda } = await prepared();
    const outcomes = await queuedSession(db, sessionId, [
      () => run(sessionId, agenda[0].topicId, 3, "start"),
      () => changeCollection(data.alice.id, { sessionId, version: 3, state: "CLOSED" })
    ]);
    expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
    const session = await db.teamSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(await db.topicDiscussion.count({ where: { sessionId } })).toBe(session.collectionState === "CLOSED" ? 0 : 1);
  });
  it("samples resume time after a queued session lock, preserving exact paused duration", async () => {
    const { sessionId, agenda } = await prepared();
    const id = agenda[0].topicId;
    await run(sessionId, id, 3, "start");
    await run(sessionId, id, 4, "pause");
    const paused = await stored(sessionId, id);
    let releasedAt = 0;
    const outcomes = await queuedSession(db, sessionId, [() => run(sessionId, id, 5, "resume")], async blocker => {
      releasedAt = (await blocker.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0].now.getTime();
    });
    expect(outcomes[0].status).toBe("fulfilled");
    const deadline = (await stored(sessionId, id)).deadlineAt!.getTime();
    expect(deadline - paused.remainingMs!).toBeGreaterThanOrEqual(releasedAt);
    expect(deadline - paused.remainingMs!).toBeLessThan(releasedAt + 1000);
  });
  it("rolls back a persisted discussion if the following session revision update fails", async () => {
    const { sessionId, agenda } = await prepared();
    await db.$executeRawUnsafe(`CREATE FUNCTION teampulse_test_reject_discussion() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."id" = TG_ARGV[0] AND NEW."lifecycleVersion" = 4 THEN
          IF (SELECT count(*) FROM "TopicDiscussion" WHERE "sessionId" = NEW."id") <> 1 THEN
            RAISE EXCEPTION 'Discussion was not written before revision';
          END IF;
          RAISE EXCEPTION 'Injected failure after discussion persistence';
        END IF;
        RETURN NEW;
      END;
    $$`);
    try {
      await db.$executeRawUnsafe(`CREATE TRIGGER teampulse_test_reject_discussion BEFORE UPDATE ON "TeamSession"
        FOR EACH ROW EXECUTE FUNCTION teampulse_test_reject_discussion('${sessionId}')`);
      await expect(run(sessionId, agenda[0].topicId, 3, "start")).rejects.toThrow(/Injected failure after discussion persistence/);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS teampulse_test_reject_discussion ON "TeamSession"`);
      await db.$executeRawUnsafe(`DROP FUNCTION teampulse_test_reject_discussion()`);
    }
    expect(await db.topicDiscussion.count({ where: { sessionId } })).toBe(0);
    expect((await db.teamSession.findUniqueOrThrow({ where: { id: sessionId } })).lifecycleVersion).toBe(3);
    await run(sessionId, agenda[0].topicId, 3, "start");
  });
  it("finishes every topic without automatic next/start/closure and retains restored access", async () => {
    const { sessionId, agenda } = await prepared(data.bob.id);
    for (let index = 0; index < agenda.length; index++) {
      await run(sessionId, agenda[index].topicId, 3 + index * 2, "start", data.bob.id);
      await run(sessionId, agenda[index].topicId, 4 + index * 2, "finish", data.bob.id);
      expect((await sessionSnapshot(data.bob.id, sessionId)).discussion.current).toBeNull();
    }
    const before = await db.topicDiscussion.findMany({ where: { sessionId }, orderBy: { topicId: "asc" } });
    await db.membership.delete({ where: { teamId_userId: { teamId: data.alpha.id, userId: data.bob.id } } });
    try { await expect(sessionSnapshot(data.bob.id, sessionId)).rejects.toMatchObject({ kind: "denied" }); }
    finally { await db.membership.create({ data: { teamId: data.alpha.id, userId: data.bob.id } }); }
    const snapshot = await sessionSnapshot(data.bob.id, sessionId);
    expect(snapshot.discussion).toMatchObject({ current: null, nextTopicId: null, canStart: false });
    expect(snapshot.state).toBe("PAUSED");
    expect(await db.topicDiscussion.findMany({ where: { sessionId }, orderBy: { topicId: "asc" } })).toEqual(before);
  });
});
