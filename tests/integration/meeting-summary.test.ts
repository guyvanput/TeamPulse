import { beforeAll, afterAll, expect, it } from "vitest";
import {
  createFacilitatedSession, createSession, createTopic, createAction, reviewAction, changeCollection,
  startVoting, finalizeVoting, controlDiscussion, controlParking, moveAgendaTopic, generateMeetingSummary
} from "../../src/lib/service";
import { sessionSnapshot } from "../../src/lib/snapshot-service";
import { db as serviceDb } from "../../src/lib/db";
import { fixture, cleanFixture, testDatabase } from "../support/database";
import { queuedSession } from "../support/queued-session";
import { summaryReportSchema } from "../../src/lib/meeting-summary";

const db = testDatabase();
let data: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { data = await fixture(db); await db.membership.create({ data: { teamId: data.alpha.id, userId: data.bob.id } }); });
afterAll(async () => { if (data) await cleanFixture(db, data); await db.$disconnect(); await serviceDb.$disconnect(); });
async function prepared(finalized = true, actor = data.alice.id, beforeClose?: (sessionId: string) => Promise<void>) {
  const session = await createFacilitatedSession(actor, { teamId: data.alpha.id, title: "Summary meeting" });
  const topics = [];
  for (let i = 0; i < 3; i++) topics.push(await createTopic(actor, { sessionId: session.id, title: `Summary ${i}`, description: "Submitted context" }));
  let version = 0;
  if (finalized) {
    await changeCollection(actor, { sessionId: session.id, state: "PAUSED", version: version++ });
    await startVoting(actor, { sessionId: session.id, version: version++ });
    await finalizeVoting(actor, { sessionId: session.id, version: version++ });
    const agenda = await db.agendaEntry.findMany({ where: { sessionId: session.id }, orderBy: { position: "asc" } });
    await moveAgendaTopic(actor, { sessionId: session.id, topicId: agenda[2].topicId, neighborTopicId: agenda[1].topicId, direction: "earlier", version: version++ });
    await controlParking(actor, { sessionId: session.id, topicId: agenda[1].topicId, reason: "Need specialist", version: version++ }, "park");
    await controlDiscussion(actor, { sessionId: session.id, topicId: agenda[0].topicId, version: version++ }, "start");
    await controlDiscussion(actor, { sessionId: session.id, topicId: agenda[0].topicId, version: version++ }, "finish");
  }
  await beforeClose?.(session.id);
  await changeCollection(actor, { sessionId: session.id, state: "CLOSED", version: version++ });
  return { sessionId: session.id, version, topics };
}
const generate = (sessionId: string, version: number, note = "Wrap-up", actor = data.alice.id) =>
  generateMeetingSummary(actor, { sessionId, version, note });
const rows = (sessionId: string) => db.sessionSummary.findMany({ where: { sessionId } });

it("MS1/2/3: generates one attributed snapshot without changing closed source or original/manual history", async () => {
  const { sessionId, version } = await prepared();
  const before = await sessionSnapshot(data.alice.id, sessionId);
  const session = await db.teamSession.findUniqueOrThrow({ where: { id: sessionId } });
  expect(before.summary).toEqual({ report: null, canGenerate: true });
  await generate(sessionId, version, "  Facilitator conclusion  ");
  const snapshot = await sessionSnapshot(data.alice.id, sessionId);
  const report = summaryReportSchema.parse(snapshot.summary.report);
  expect(report).toMatchObject({ formatVersion: 1, note: "Facilitator conclusion", generatedBy: { id: data.alice.id, name: data.alice.name } });
  expect(report.content.topics.map(item => [item.outcome, item.discussionPosition])).toEqual([["DISCUSSED", 1], ["DEFERRED", 3], ["NOT_DISCUSSED", 2]]);
  expect(report.content.topics[1].reason).toBe("Need specialist");
  expect(snapshot.summary.canGenerate).toBe(false);
  expect({ ...snapshot.discussion, sampledAt: before.discussion.sampledAt }).toEqual(before.discussion);
  expect(snapshot.parking).toEqual(before.parking);
  expect(snapshot.agendaOrder).toEqual(before.agendaOrder);
  expect(await db.teamSession.findUniqueOrThrow({ where: { id: sessionId } })).toEqual(session);
  await expect(generate(sessionId, version, "Replacement")).rejects.toMatchObject({ kind: "conflict" });
  expect(await rows(sessionId)).toHaveLength(1);
});
it("MS1/2: old unprioritized closed meetings remain empty until explicit generation, without invented voting", async () => {
  const { sessionId, version } = await prepared(false);
  expect((await sessionSnapshot(data.bob.id, sessionId)).summary).toEqual({ report: null, canGenerate: false });
  await generateMeetingSummary(data.alice.id, { sessionId, version });
  const report = summaryReportSchema.parse((await sessionSnapshot(data.bob.id, sessionId)).summary.report);
  expect(report.note).toBe("");
  expect(report.content.votingState).toBe("NOT_STARTED");
  expect(report.content.topics.every(item => item.voteCount === null && item.originalPosition === null && item.outcome === "NOT_DISCUSSED")).toBe(true);
});
it("MS4: includes created/reviewed-here Done actions, excludes unrelated work and never rewrites live follow-up or captured names", async () => {
  const earlier = await createSession(data.alice.id, { teamId: data.alpha.id, title: "Earlier summary actions" });
  await db.teamSession.update({ where: { id: earlier.id }, data: { createdAt: new Date("2025-01-01") } });
  const create = (title: string) => createAction(data.alice.id, { sessionId: earlier.id, title, context: "Keep context", ownerId: data.alice.id, dueDate: "2026-11-01" });
  const progress = await create("Progress action"), done = await create("Done here"), unrelated = await create("Unrelated");
  const { sessionId, version } = await prepared(true, data.alice.id, async id => {
    await createAction(data.alice.id, { sessionId: id, title: "Created here", context: "Owned", ownerId: data.alice.id, dueDate: "" });
    await reviewAction(data.alice.id, { sessionId: id, actionId: progress.id, status: "IN_PROGRESS", note: "Recorded here" });
    await reviewAction(data.alice.id, { sessionId: id, actionId: done.id, status: "DONE", note: "Done note" });
  });
  await generate(sessionId, version);
  const before = summaryReportSchema.parse((await sessionSnapshot(data.alice.id, sessionId)).summary.report);
  expect(before.content.actions).toHaveLength(3);
  expect(before.content.actions.some(item => item.id === unrelated.id)).toBe(false);
  expect(before.content.actions.find(item => item.id === done.id)?.status).toBe("DONE");
  const later = await createSession(data.alice.id, { teamId: data.alpha.id, title: "Later summary progress" });
  await reviewAction(data.alice.id, { sessionId: later.id, actionId: progress.id, status: "DONE", note: "Completed later" });
  await db.user.update({ where: { id: data.alice.id }, data: { name: "Changed after generation" } });
  try {
    expect((await sessionSnapshot(data.bob.id, sessionId)).summary.report).toEqual(before);
    expect((await db.action.findUniqueOrThrow({ where: { id: progress.id } })).status).toBe("DONE");
  } finally { await db.user.update({ where: { id: data.alice.id }, data: { name: data.alice.name } }); }
});
it("MS1: denies roles, nonjoined facilitation, foreign/legacy/live sessions, stale revisions and forged payloads", async () => {
  const { sessionId, version } = await prepared();
  for (const actor of ["", data.bob.id]) await expect(generate(sessionId, version, "", actor)).rejects.toMatchObject({ kind: "denied" });
  await expect(generate(sessionId, version - 1)).rejects.toMatchObject({ kind: "conflict" });
  await expect(generateMeetingSummary(data.alice.id, { sessionId, version, actorId: data.bob.id })).rejects.toMatchObject({ kind: "validation" });
  const legacy = await createSession(data.alice.id, { teamId: data.alpha.id, title: "Legacy" });
  await expect(generate(legacy.id, 0)).rejects.toMatchObject({ kind: "conflict" });
  const live = await createFacilitatedSession(data.alice.id, { teamId: data.alpha.id, title: "Live" });
  await expect(generate(live.id, 0)).rejects.toMatchObject({ kind: "conflict" });
  const foreign = await createFacilitatedSession(data.bob.id, { teamId: data.beta.id, title: "Foreign" });
  await expect(generate(foreign.id, 0)).rejects.toMatchObject({ kind: "denied" });
  await db.sessionParticipant.delete({ where: { sessionId_userId: { sessionId, userId: data.alice.id } } });
  await expect(generate(sessionId, version)).rejects.toMatchObject({ kind: "denied" });
  expect(await rows(sessionId)).toHaveLength(0);
});
it("MS5: queued competing generation retains one report and explicitly conflicts without replay", async () => {
  const { sessionId, version } = await prepared();
  const results = await queuedSession(db, sessionId, [() => generate(sessionId, version, "First"), () => generate(sessionId, version, "Second")]);
  expect(results.filter(item => item.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(item => item.status === "rejected")).toEqual([expect.objectContaining({ reason: expect.objectContaining({ kind: "conflict" }) })]);
  expect(await rows(sessionId)).toHaveLength(1);
});
it("MS1/5: queued membership deletion denies or aborts generation and never saves a stale-authorized artifact", async () => {
  const { sessionId, version } = await prepared(true, data.bob.id);
  const results = await queuedSession(db, sessionId, [() => generate(sessionId, version, "", data.bob.id)], async blocker => {
    await blocker.query(`DELETE FROM "Membership" WHERE "teamId"=$1 AND "userId"=$2`, [data.alpha.id, data.bob.id]);
  });
  try {
    expect(results).toEqual([expect.objectContaining({ status: "rejected", reason: expect.objectContaining({ kind: expect.stringMatching(/denied|conflict/) }) })]);
    expect(await rows(sessionId)).toHaveLength(0);
    await expect(sessionSnapshot(data.bob.id, sessionId)).rejects.toMatchObject({ kind: "denied" });
  } finally { await db.membership.create({ data: { teamId: data.alpha.id, userId: data.bob.id } }); }
});
it("MS4: real post-snapshot action review cannot mix the later status into the captured document", async () => {
  const earlier = await createSession(data.alice.id, { teamId: data.alpha.id, title: "Before capture" });
  await db.teamSession.update({ where: { id: earlier.id }, data: { createdAt: new Date("2025-01-01") } });
  const action = await createAction(data.alice.id, { sessionId: earlier.id, title: "Snapshot action", context: "", ownerId: data.alice.id, dueDate: "" });
  const { sessionId, version } = await prepared(true, data.alice.id, async id => {
    await reviewAction(data.alice.id, { sessionId: id, actionId: action.id, status: "IN_PROGRESS", note: "Before snapshot" });
  });
  const later = await createSession(data.alice.id, { teamId: data.alpha.id, title: "After capture" });
  const result = await queuedSession(db, sessionId, [() => generate(sessionId, version)], async () => {
    await reviewAction(data.alice.id, { sessionId: later.id, actionId: action.id, status: "DONE", note: "After snapshot" });
  });
  expect(result[0].status).toBe("fulfilled");
  const report = summaryReportSchema.parse((await sessionSnapshot(data.alice.id, sessionId)).summary.report);
  expect(report.content.actions[0]).toMatchObject({ status: "IN_PROGRESS", reviews: [{ resultingStatus: "IN_PROGRESS", note: "Before snapshot" }] });
  expect((await db.action.findUniqueOrThrow({ where: { id: action.id } })).status).toBe("DONE");
});
it("MS5: failure after the actual report insert rolls back without source mutation", async () => {
  const { sessionId, version } = await prepared();
  const before = await db.teamSession.findUniqueOrThrow({ where: { id: sessionId } });
  await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION teampulse_test_reject_summary() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW."sessionId"=TG_ARGV[0] THEN RAISE EXCEPTION 'Injected failure after report insert'; END IF; RETURN NEW; END; $$`);
  let triggerCreated = false;
  try {
    await db.$executeRawUnsafe(`CREATE TRIGGER teampulse_test_reject_summary AFTER INSERT ON "SessionSummary"
      FOR EACH ROW EXECUTE FUNCTION teampulse_test_reject_summary('${sessionId}')`);
    triggerCreated = true;
    await expect(generate(sessionId, version)).rejects.toThrow(/Injected failure after report insert/);
  } finally {
    if (triggerCreated) await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS teampulse_test_reject_summary ON "SessionSummary"`);
    await db.$executeRawUnsafe(`DROP FUNCTION teampulse_test_reject_summary()`);
  }
  expect(await rows(sessionId)).toHaveLength(0);
  expect(await db.teamSession.findUniqueOrThrow({ where: { id: sessionId } })).toEqual(before);
});
it("MS7: malformed stored document fails the protected read, never silently regenerates or hides the report", async () => {
  const { sessionId, version } = await prepared();
  await generate(sessionId, version);
  await db.sessionSummary.update({ where: { sessionId }, data: { content: {} } });
  await expect(sessionSnapshot(data.alice.id, sessionId)).rejects.toThrow();
  expect(await rows(sessionId)).toHaveLength(1);
});
