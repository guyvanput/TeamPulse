import { beforeAll, afterAll, expect, it } from "vitest";
import {
  createFacilitatedSession, createSession, createTopic, joinSession, changeCollection,
  startVoting, finalizeVoting, controlDiscussion, controlParking
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
  const session = await createFacilitatedSession(actor, { teamId: data.alpha.id, title: "Parking" });
  for (let i = 0; i < 3; i++) await createTopic(actor, { sessionId: session.id, title: `Topic ${i}`, description: "Keep" });
  await changeCollection(actor, { sessionId: session.id, state: "PAUSED", version: 0 });
  await startVoting(actor, { sessionId: session.id, version: 1 });
  await finalizeVoting(actor, { sessionId: session.id, version: 2 });
  const agenda = await db.agendaEntry.findMany({ where: { sessionId: session.id }, orderBy: { position: "asc" } });
  return { sessionId: session.id, agenda };
}
const move = (sessionId: string, topicId: string, version: number, operation: "park" | "restore", reason?: string, actor?: string) =>
  controlParking(actor ?? data.alice.id, { sessionId, topicId, version, ...(reason === undefined ? {} : { reason }) }, operation);
const clock = (sessionId: string, topicId: string, version: number, operation: Parameters<typeof controlDiscussion>[2], actor?: string) =>
  controlDiscussion(actor ?? data.alice.id, { sessionId, topicId, version }, operation);
const rows = (sessionId: string) => db.topicDiscussion.findMany({ where: { sessionId }, orderBy: [{ topicId: "asc" }, { attemptNumber: "asc" }] });
const events = (sessionId: string) => db.topicParkingEvent.findMany({ where: { sessionId }, orderBy: { version: "asc" } });

it("PL1/2: parks waiting topics without fictional clocks and preserves frozen results", async () => {
  const { sessionId, agenda } = await prepared();
  await move(sessionId, agenda[0].topicId, 3, "park", "  Later <script>alert(1)</script>  ");
  expect(await rows(sessionId)).toHaveLength(0);
  expect(await events(sessionId)).toEqual([expect.objectContaining({
    topicId: agenda[0].topicId, version: 4, kind: "PARK", reason: "Later <script>alert(1)</script>",
    attemptNumber: null, actorId: data.alice.id
  })]);
  const snapshot = await sessionSnapshot(data.bob.id, sessionId);
  expect(snapshot.discussion.entries.map(item => item.state)).toEqual(["PARKED", "NOT_STARTED", "NOT_STARTED"]);
  expect(snapshot.discussion.nextTopicId).toBe(agenda[1].topicId);
  expect(snapshot.parking.entries[0]).toMatchObject({ parked: true, canPark: false, canRestore: false });
  expect(await db.agendaEntry.findMany({ where: { sessionId }, orderBy: { position: "asc" } })).toEqual(agenda);
  await expect(move(sessionId, agenda[0].topicId, 4, "park")).rejects.toMatchObject({ kind: "conflict" });
  expect(await events(sessionId)).toHaveLength(1);
});
it.each(["RUNNING", "PAUSED", "EXPIRED"] as const)("PL3: parking %s ends only its exact clock with Deferred history", async state => {
  const { sessionId, agenda } = await prepared();
  const topicId = agenda[0].topicId;
  await clock(sessionId, topicId, 3, "start");
  await db.topicDiscussion.update({
    where: { sessionId_topicId_attemptNumber: { sessionId, topicId, attemptNumber: 1 } },
    data: state === "PAUSED" ? { state: "PAUSED", deadlineAt: null, remainingMs: 200001 }
      : { deadlineAt: new Date(Date.now() + (state === "EXPIRED" ? -60000 : 100000)) }
  });
  const before = (await rows(sessionId))[0];
  await move(sessionId, topicId, 4, "park", "Defer");
  const after = (await rows(sessionId))[0];
  expect(after).toMatchObject({ state: "FINISHED", outcome: "DEFERRED", deadlineAt: null, allocatedMs: before.allocatedMs,
    startedAt: before.startedAt, startedById: before.startedById, finishedById: data.alice.id });
  expect(after.remainingMs).toBe(state === "PAUSED" ? 200001 : state === "EXPIRED" ? 0 : before.deadlineAt!.getTime() - after.finishedAt!.getTime());
  expect((await events(sessionId))[0]).toMatchObject({ attemptNumber: 1, createdAt: after.finishedAt });
  expect((await sessionSnapshot(data.alice.id, sessionId)).discussion.current).toBeNull();
  expect(await rows(sessionId)).toHaveLength(1);
});
it("PL4: repeated restore/start cycles retain old timeboxes and start fresh in original order", async () => {
  const { sessionId, agenda } = await prepared();
  const a = agenda[0].topicId, b = agenda[1].topicId;
  await clock(sessionId, a, 3, "start");
  await move(sessionId, a, 4, "park", "First");
  const first = (await rows(sessionId))[0];
  await clock(sessionId, b, 5, "start");
  const other = (await rows(sessionId)).find(item => item.topicId === b);
  await move(sessionId, a, 6, "restore");
  expect((await rows(sessionId)).find(item => item.topicId === b)).toEqual(other);
  expect((await sessionSnapshot(data.alice.id, sessionId)).discussion.nextTopicId).toBe(a);
  await expect(clock(sessionId, a, 7, "start")).rejects.toMatchObject({ kind: "conflict" });
  await clock(sessionId, b, 7, "finish");
  await clock(sessionId, a, 8, "start");
  const second = (await rows(sessionId)).find(item => item.topicId === a && item.attemptNumber === 2)!;
  expect(second).toMatchObject({ allocatedMs: 300000, outcome: null, state: "RUNNING" });
  expect(second.deadlineAt!.getTime() - second.startedAt.getTime()).toBe(300000);
  await expect(clock(sessionId, a, 4, "finish")).rejects.toMatchObject({ kind: "conflict" });
  await move(sessionId, a, 9, "park", "Second");
  await move(sessionId, a, 10, "restore");
  await move(sessionId, a, 11, "park", "Waiting again");
  expect((await events(sessionId)).at(-1)?.attemptNumber).toBeNull();
  await move(sessionId, a, 12, "restore");
  await clock(sessionId, a, 13, "start");
  await clock(sessionId, a, 14, "finish");
  expect((await rows(sessionId)).find(item => item.topicId === a && item.attemptNumber === 1)).toEqual(first);
  expect((await rows(sessionId)).filter(item => item.topicId === a).map(item => item.outcome)).toEqual(["DEFERRED", "DEFERRED", "DISCUSSED"]);
  await expect(move(sessionId, a, 15, "park")).rejects.toMatchObject({ kind: "conflict" });
  await expect(move(sessionId, a, 15, "restore")).rejects.toMatchObject({ kind: "conflict" });
});
it("PL5: all parked differs from all Discussed and close retains distinct outcomes", async () => {
  const { sessionId, agenda } = await prepared();
  for (let i = 0; i < 3; i++) await move(sessionId, agenda[i].topicId, 3 + i, "park");
  const snapshot = await sessionSnapshot(data.alice.id, sessionId);
  expect(snapshot.discussion).toMatchObject({ nextTopicId: null, current: null, canStart: false, allDiscussed: false });
  expect(snapshot.voting.canClose).toBe(true);
  await changeCollection(data.alice.id, { sessionId, state: "CLOSED", version: 6 });
  await expect(move(sessionId, agenda[0].topicId, 7, "restore")).rejects.toMatchObject({ kind: "conflict" });
  expect((await sessionSnapshot(data.alice.id, sessionId)).discussion.entries.map(item => item.state)).toEqual(["PARKED", "PARKED", "PARKED"]);
});
it("PL1: checks current joined facilitator, exact scope and phase, preserving history on revoked/restored access", async () => {
  const { sessionId, agenda } = await prepared(data.bob.id);
  const topicId = agenda[0].topicId;
  for (const actor of ["", data.alice.id]) await expect(move(sessionId, topicId, 3, "park", "", actor)).rejects.toMatchObject({ kind: "denied" });
  await joinSession(data.alice.id, { sessionId });
  await expect(move(sessionId, topicId, 3, "park", "", data.alice.id)).rejects.toMatchObject({ kind: "denied" });
  await expect(move(sessionId, "missing", 3, "park", "", data.bob.id)).rejects.toMatchObject({ kind: "denied" });
  const foreign = await createFacilitatedSession(data.bob.id, { teamId: data.beta.id, title: "Foreign" });
  await expect(move(foreign.id, topicId, 0, "park")).rejects.toMatchObject({ kind: "denied" });
  const legacy = await createSession(data.alice.id, { teamId: data.alpha.id, title: "Legacy" });
  await expect(move(legacy.id, topicId, 0, "park")).rejects.toMatchObject({ kind: "conflict" });
  const collecting = await createFacilitatedSession(data.alice.id, { teamId: data.alpha.id, title: "Collection" });
  await expect(move(collecting.id, topicId, 0, "park")).rejects.toMatchObject({ kind: "conflict" });
  await move(sessionId, topicId, 3, "park", "Retain", data.bob.id);
  const before = await events(sessionId);
  await db.membership.delete({ where: { teamId_userId: { teamId: data.alpha.id, userId: data.bob.id } } });
  try { await expect(sessionSnapshot(data.bob.id, sessionId)).rejects.toMatchObject({ kind: "denied" }); }
  finally { await db.membership.create({ data: { teamId: data.alpha.id, userId: data.bob.id } }); }
  expect(await events(sessionId)).toEqual(before);
  await move(sessionId, topicId, 4, "restore", undefined, data.bob.id);
});
it.each(["finish", "extend", "start", "close", "park"] as const)("PL6: serializes park versus %s", async operation => {
  const { sessionId, agenda } = await prepared();
  const a = agenda[0].topicId;
  if (operation === "finish" || operation === "extend") await clock(sessionId, a, 3, "start");
  const version = operation === "finish" || operation === "extend" ? 4 : 3;
  const other = () => operation === "close" ? changeCollection(data.alice.id, { sessionId, version, state: "CLOSED" })
    : operation === "park" ? move(sessionId, a, version, "park") : clock(sessionId, a, version, operation);
  const outcomes = await queuedSession(db, sessionId, [() => move(sessionId, a, version, "park"), other]);
  expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter(item => item.status === "rejected")).toHaveLength(1);
  const snapshot = await sessionSnapshot(data.alice.id, sessionId);
  expect(snapshot.lifecycleVersion).toBe(version + 1);
  expect((await events(sessionId)).length).toBeLessThanOrEqual(1);
});
it.each(["start", "close", "restore"] as const)("PL6: serializes restore versus %s", async operation => {
  const { sessionId, agenda } = await prepared();
  const a = agenda[0].topicId, b = agenda[1].topicId;
  await move(sessionId, a, 3, "park");
  const other = () => operation === "close" ? changeCollection(data.alice.id, { sessionId, version: 4, state: "CLOSED" })
    : operation === "restore" ? move(sessionId, a, 4, "restore") : clock(sessionId, b, 4, "start");
  const outcomes = await queuedSession(db, sessionId, [() => move(sessionId, a, 4, "restore"), other]);
  expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter(item => item.status === "rejected")).toHaveLength(1);
  expect((await sessionSnapshot(data.alice.id, sessionId)).lifecycleVersion).toBe(5);
});
it("PL6: denies a queued park after membership revocation without event or timer changes", async () => {
  const { sessionId, agenda } = await prepared(data.bob.id);
  const outcomes = await queuedSession(db, sessionId, [() => move(sessionId, agenda[0].topicId, 3, "park", "", data.bob.id)], async blocker => {
    await blocker.query(`DELETE FROM "Membership" WHERE "teamId"=$1 AND "userId"=$2`, [data.alpha.id, data.bob.id]);
  });
  try {
    expect(outcomes[0]).toMatchObject({ status: "rejected", reason: { kind: "denied" } });
    expect(await events(sessionId)).toHaveLength(0);
  } finally { await db.membership.create({ data: { teamId: data.alpha.id, userId: data.bob.id } }); }
});
it("PL6: rolls back both current terminalization and its event when revision persistence fails", async () => {
  const { sessionId, agenda } = await prepared();
  await clock(sessionId, agenda[0].topicId, 3, "start");
  const before = await rows(sessionId);
  await db.$executeRawUnsafe(`CREATE FUNCTION teampulse_test_reject_parking() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW."id" = TG_ARGV[0] AND NEW."lifecycleVersion" = 5 THEN
        IF (SELECT count(*) FROM "TopicParkingEvent" WHERE "sessionId"=NEW."id") <> 1 OR
           (SELECT count(*) FROM "TopicDiscussion" WHERE "sessionId"=NEW."id" AND "outcome"='DEFERRED') <> 1 THEN
          RAISE EXCEPTION 'Parking writes were not present before revision';
        END IF;
        RAISE EXCEPTION 'Injected failure after parking persistence';
      END IF;
      RETURN NEW;
    END; $$`);
  try {
    await db.$executeRawUnsafe(`CREATE TRIGGER teampulse_test_reject_parking BEFORE UPDATE ON "TeamSession"
      FOR EACH ROW EXECUTE FUNCTION teampulse_test_reject_parking('${sessionId}')`);
    await expect(move(sessionId, agenda[0].topicId, 4, "park")).rejects.toThrow(/Injected failure after parking persistence/);
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS teampulse_test_reject_parking ON "TeamSession"`);
    await db.$executeRawUnsafe(`DROP FUNCTION teampulse_test_reject_parking()`);
  }
  expect(await rows(sessionId)).toEqual(before);
  expect(await events(sessionId)).toHaveLength(0);
  expect((await sessionSnapshot(data.alice.id, sessionId)).lifecycleVersion).toBe(4);
});
