import { beforeAll, afterAll, expect, it } from "vitest";
import {
  createFacilitatedSession, createSession, createTopic, joinSession, changeCollection,
  startVoting, finalizeVoting, controlDiscussion, controlParking, moveAgendaTopic
} from "../../src/lib/service";
import { sessionSnapshot } from "../../src/lib/snapshot-service";
import { db as serviceDb } from "../../src/lib/db";
import { fixture, cleanFixture, testDatabase } from "../support/database";
import { queuedSession } from "../support/queued-session";

const db = testDatabase();
let data: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { data = await fixture(db); await db.membership.create({ data: { teamId: data.alpha.id, userId: data.bob.id } }); });
afterAll(async () => { if (data) await cleanFixture(db, data); await db.$disconnect(); await serviceDb.$disconnect(); });
async function prepared(actor = data.alice.id) {
  const session = await createFacilitatedSession(actor, { teamId: data.alpha.id, title: "Agenda order" });
  for (let i = 0; i < 5; i++) await createTopic(actor, { sessionId: session.id, title: `Order ${i}`, description: "Keep" });
  await changeCollection(actor, { sessionId: session.id, state: "PAUSED", version: 0 });
  await startVoting(actor, { sessionId: session.id, version: 1 });
  await finalizeVoting(actor, { sessionId: session.id, version: 2 });
  const agenda = await db.agendaEntry.findMany({ where: { sessionId: session.id }, orderBy: { position: "asc" } });
  return { sessionId: session.id, ids: agenda.map(item => item.topicId), agenda };
}
const move = (sessionId: string, topicId: string, neighborTopicId: string, version: number, direction = "earlier", actor = data.alice.id) =>
  moveAgendaTopic(actor, { sessionId, topicId, neighborTopicId, version, direction });
const clock = (sessionId: string, topicId: string, version: number, operation: Parameters<typeof controlDiscussion>[2]) =>
  controlDiscussion(data.alice.id, { sessionId, topicId, version }, operation);
const park = (sessionId: string, topicId: string, version: number, operation: "park" | "restore") =>
  controlParking(data.alice.id, { sessionId, topicId, version }, operation);
const entries = (sessionId: string) => db.agendaEntry.findMany({ where: { sessionId }, orderBy: { position: "asc" } });
const history = (sessionId: string) => db.agendaOrderChange.findMany({ where: { sessionId }, orderBy: { version: "asc" } });

it("MO2/4: swaps exact future neighbors, retains ranks and both directions of immutable history", async () => {
  const { sessionId, ids, agenda } = await prepared();
  await move(sessionId, ids[2], ids[1], 3);
  expect((await entries(sessionId)).map(item => item.discussionPosition)).toEqual([1, 3, 2, 4, 5]);
  expect((await history(sessionId))[0]).toMatchObject({
    version: 4, actorId: data.alice.id, direction: "EARLIER", beforeQueue: ids,
    afterQueue: [ids[0], ids[2], ids[1], ids[3], ids[4]]
  });
  await move(sessionId, ids[2], ids[1], 4, "later");
  expect(await entries(sessionId)).toEqual(agenda);
  expect(await history(sessionId)).toHaveLength(2);
  await changeCollection(data.alice.id, { sessionId, version: 5, state: "CLOSED" });
  expect((await sessionSnapshot(data.bob.id, sessionId)).agendaOrder.history).toHaveLength(2);
  await expect(move(sessionId, ids[2], ids[1], 6)).rejects.toMatchObject({ kind: "conflict" });
});
it("MO2: freezes current/Discussed physical slots while swapping future neighbors across them", async () => {
  const { sessionId, ids } = await prepared();
  await clock(sessionId, ids[0], 3, "start");
  await clock(sessionId, ids[0], 4, "finish");
  await clock(sessionId, ids[1], 5, "start");
  const clockBefore = await db.topicDiscussion.findMany({ where: { sessionId } });
  await move(sessionId, ids[4], ids[3], 6);
  await expect(move(sessionId, ids[1], ids[2], 7, "later")).rejects.toMatchObject({ kind: "conflict" });
  await expect(move(sessionId, ids[0], ids[2], 7, "later")).rejects.toMatchObject({ kind: "conflict" });
  expect(await db.topicDiscussion.findMany({ where: { sessionId } })).toEqual(clockBefore);
  expect((await entries(sessionId)).map(item => item.discussionPosition)).toEqual([1, 2, 3, 5, 4]);
  const snapshot = await sessionSnapshot(data.alice.id, sessionId);
  expect(snapshot.discussion.entries.map(item => item.topicId)).toEqual(ids);
  expect(snapshot.agendaOrder.future.map(item => item.topicId)).toEqual([ids[2], ids[4], ids[3]]);
});
it("MO3: moves parked placeholders and restores at saved manual position with fresh attempts", async () => {
  const { sessionId, ids } = await prepared();
  await park(sessionId, ids[1], 3, "park");
  await move(sessionId, ids[1], ids[2], 4, "later");
  await park(sessionId, ids[1], 5, "restore");
  await clock(sessionId, ids[0], 6, "start");
  await clock(sessionId, ids[0], 7, "finish");
  expect((await sessionSnapshot(data.alice.id, sessionId)).discussion.nextTopicId).toBe(ids[2]);
  await clock(sessionId, ids[2], 8, "start");
  await park(sessionId, ids[2], 9, "park");
  const old = await db.topicDiscussion.findFirstOrThrow({ where: { sessionId, topicId: ids[2] } });
  expect((await sessionSnapshot(data.alice.id, sessionId)).agendaOrder.future.map(item => item.topicId)).toEqual([ids[2], ids[1], ids[3], ids[4]]);
  await park(sessionId, ids[2], 10, "restore");
  await clock(sessionId, ids[2], 11, "start");
  const attempts = await db.topicDiscussion.findMany({ where: { sessionId, topicId: ids[2] }, orderBy: { attemptNumber: "asc" } });
  expect(attempts[0]).toEqual(old);
  expect(attempts[1].deadlineAt!.getTime() - attempts[1].startedAt.getTime()).toBe(300000);
});
it("MO2/3: swaps future neighbors across frozen physical slots, then reinserts a parked current topic at its saved slot", async () => {
  const { sessionId, ids } = await prepared();
  await park(sessionId, ids[0], 3, "park");
  await clock(sessionId, ids[1], 4, "start");
  await clock(sessionId, ids[1], 5, "finish");
  await clock(sessionId, ids[2], 6, "start");
  const attempts = await db.topicDiscussion.findMany({ where: { sessionId } });
  await move(sessionId, ids[3], ids[0], 7);
  expect((await entries(sessionId)).map(item => item.discussionPosition)).toEqual([4, 2, 3, 1, 5]);
  expect(await db.topicDiscussion.findMany({ where: { sessionId } })).toEqual(attempts);
  await park(sessionId, ids[2], 8, "park");
  const snapshot = await sessionSnapshot(data.alice.id, sessionId);
  expect(snapshot.agendaOrder.future.map(item => item.topicId)).toEqual([ids[3], ids[2], ids[0], ids[4]]);
  expect(snapshot.discussion.nextTopicId).toBe(ids[3]);
});
it("MO1/7: rejects roles, foreign IDs, phases, stale versions/neighbors and boundary no-ops without history", async () => {
  const { sessionId, ids } = await prepared();
  for (const actor of ["", data.bob.id]) await expect(move(sessionId, ids[2], ids[1], 3, "earlier", actor)).rejects.toMatchObject({ kind: "denied" });
  await joinSession(data.bob.id, { sessionId });
  await expect(move(sessionId, ids[2], ids[1], 3, "earlier", data.bob.id)).rejects.toMatchObject({ kind: "denied" });
  await expect(move(sessionId, "missing", ids[1], 3)).rejects.toMatchObject({ kind: "denied" });
  await expect(move(sessionId, ids[2], ids[0], 3)).rejects.toMatchObject({ kind: "conflict" });
  await expect(move(sessionId, ids[0], ids[1], 3)).rejects.toMatchObject({ kind: "conflict" });
  await expect(move(sessionId, ids[2], ids[1], 2)).rejects.toMatchObject({ kind: "conflict" });
  const legacy = await createSession(data.alice.id, { teamId: data.alpha.id, title: "Legacy" });
  await expect(move(legacy.id, ids[2], ids[1], 0)).rejects.toMatchObject({ kind: "conflict" });
  const collecting = await createFacilitatedSession(data.alice.id, { teamId: data.alpha.id, title: "Collecting" });
  await expect(move(collecting.id, ids[2], ids[1], 0)).rejects.toMatchObject({ kind: "conflict" });
  const otherTopic = await createTopic(data.alice.id, { sessionId: collecting.id, title: "Other session", description: "" });
  await expect(move(sessionId, ids[2], otherTopic.id, 3)).rejects.toMatchObject({ kind: "denied" });
  await changeCollection(data.alice.id, { sessionId: collecting.id, state: "PAUSED", version: 0 });
  await startVoting(data.alice.id, { sessionId: collecting.id, version: 1 });
  await expect(move(collecting.id, ids[2], ids[1], 2)).rejects.toMatchObject({ kind: "conflict" });
  const foreign = await createFacilitatedSession(data.bob.id, { teamId: data.beta.id, title: "Foreign" });
  const foreignTopic = await createTopic(data.bob.id, { sessionId: foreign.id, title: "Foreign topic", description: "" });
  await expect(move(sessionId, ids[2], foreignTopic.id, 3)).rejects.toMatchObject({ kind: "denied" });
  await db.topic.update({ where: { id: ids[2] }, data: { removedAt: new Date(), removedById: data.alice.id } });
  await expect(move(sessionId, ids[2], ids[1], 3)).rejects.toMatchObject({ kind: "denied" });
  expect(await history(sessionId)).toHaveLength(0);
});
it("MO1: nonjoined facilitator and exhausted lifecycle versions cannot mutate the plan", async () => {
  const { sessionId, ids, agenda } = await prepared();
  await db.sessionParticipant.delete({ where: { sessionId_userId: { sessionId, userId: data.alice.id } } });
  await expect(move(sessionId, ids[2], ids[1], 3)).rejects.toMatchObject({ kind: "denied" });
  await joinSession(data.alice.id, { sessionId });
  await db.teamSession.update({ where: { id: sessionId }, data: { lifecycleVersion: 2147483647 } });
  await expect(move(sessionId, ids[2], ids[1], 2147483647)).rejects.toMatchObject({ kind: "conflict" });
  expect(await entries(sessionId)).toEqual(agenda);
  expect(await history(sessionId)).toHaveLength(0);
});
it.each(["move", "start", "finish", "park", "restore", "close"] as const)("MO5: serializes move versus %s", async operation => {
  const { sessionId, ids } = await prepared();
  let version = 3;
  if (operation === "finish" || operation === "park") { await clock(sessionId, ids[0], 3, "start"); version++; }
  if (operation === "restore") { await park(sessionId, ids[1], 3, "park"); version++; }
  const other = () => operation === "move" ? move(sessionId, ids[4], ids[3], version)
    : operation === "close" ? changeCollection(data.alice.id, { sessionId, version, state: "CLOSED" })
      : operation === "park" ? park(sessionId, ids[0], version, "park")
        : operation === "restore" ? park(sessionId, ids[1], version, "restore")
          : clock(sessionId, ids[0], version, operation);
  const outcomes = await queuedSession(db, sessionId, [() => move(sessionId, ids[2], ids[1], version), other]);
  expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter(item => item.status === "rejected")).toHaveLength(1);
  expect((await sessionSnapshot(data.alice.id, sessionId)).lifecycleVersion).toBe(version + 1);
});
it("MO5: denies a queued move after membership revocation", async () => {
  const { sessionId, ids, agenda } = await prepared(data.bob.id);
  const outcomes = await queuedSession(db, sessionId, [() => move(sessionId, ids[2], ids[1], 3, "earlier", data.bob.id)], async blocker => {
    await blocker.query(`DELETE FROM "Membership" WHERE "teamId"=$1 AND "userId"=$2`, [data.alpha.id, data.bob.id]);
  });
  try {
    expect(outcomes[0]).toMatchObject({ status: "rejected", reason: { kind: "denied" } });
    expect(await entries(sessionId)).toEqual(agenda);
    expect(await history(sessionId)).toHaveLength(0);
  } finally { await db.membership.create({ data: { teamId: data.alpha.id, userId: data.bob.id } }); }
});
it("MO5: deferred uniqueness rejects an incomplete swap at commit and rolls back history/version", async () => {
  const { sessionId, ids, agenda } = await prepared();
  await expect(db.$transaction(async tx => {
    await tx.$executeRaw`SET CONSTRAINTS "AgendaEntry_sessionId_discussionPosition_key" DEFERRED`;
    await tx.agendaEntry.update({ where: { sessionId_topicId: { sessionId, topicId: ids[0] } }, data: { discussionPosition: 2 } });
    await tx.agendaOrderChange.create({ data: { teamId: data.alpha.id, sessionId, version: 4, actorId: data.alice.id,
      createdAt: new Date(), topicId: ids[0], neighborTopicId: ids[1], direction: "LATER", beforeQueue: ids, afterQueue: [ids[1], ids[0], ...ids.slice(2)] } });
    await tx.teamSession.update({ where: { id: sessionId }, data: { lifecycleVersion: 4 } });
  })).rejects.toThrow();
  expect(await entries(sessionId)).toEqual(agenda);
  expect(await history(sessionId)).toHaveLength(0);
  expect((await db.teamSession.findUniqueOrThrow({ where: { id: sessionId } })).lifecycleVersion).toBe(3);
});
it("MO5: injected failure after the real swap and event rolls back every related write", async () => {
  const { sessionId, ids, agenda } = await prepared();
  await db.$executeRawUnsafe(`CREATE FUNCTION teampulse_test_reject_order() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW."id"=TG_ARGV[0] AND NEW."lifecycleVersion"=4 THEN
        IF (SELECT count(*) FROM "AgendaOrderChange" WHERE "sessionId"=NEW."id") <> 1 OR
          (SELECT "discussionPosition" FROM "AgendaEntry" WHERE "sessionId"=NEW."id" AND "topicId"=TG_ARGV[1]) <> 2 THEN
          RAISE EXCEPTION 'Order writes were not present before revision';
        END IF;
        RAISE EXCEPTION 'Injected failure after order persistence';
      END IF;
      RETURN NEW;
    END; $$`);
  try {
    await db.$executeRawUnsafe(`CREATE TRIGGER teampulse_test_reject_order BEFORE UPDATE ON "TeamSession"
      FOR EACH ROW EXECUTE FUNCTION teampulse_test_reject_order('${sessionId}','${ids[2]}')`);
    await expect(move(sessionId, ids[2], ids[1], 3)).rejects.toThrow(/Injected failure after order persistence/);
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS teampulse_test_reject_order ON "TeamSession"`);
    await db.$executeRawUnsafe(`DROP FUNCTION teampulse_test_reject_order()`);
  }
  expect(await entries(sessionId)).toEqual(agenda);
  expect(await history(sessionId)).toHaveLength(0);
});
