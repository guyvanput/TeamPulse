import { beforeAll, afterAll, expect, it } from "vitest";
import {
  createFacilitatedSession, createSession, joinSession, createTopic, changeTopic, changeCollection,
  createAction, reviewAction, startVoting, finalizeVoting, setTopicVote, controlDiscussion,
  controlParking, moveAgendaTopic, generateMeetingSummary, administerSession
} from "../../src/lib/service";
import { sessionSnapshot } from "../../src/lib/snapshot-service";
import { db as serviceDb } from "../../src/lib/db";
import { fixture, cleanFixture, testDatabase } from "../support/database";
import { queuedSession } from "../support/queued-session";
import { snapshotSchema } from "../../src/lib/session-snapshot";

const db = testDatabase();
let data: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { data = await fixture(db); await db.membership.create({ data: { teamId: data.alpha.id, userId: data.bob.id } }); });
afterAll(async () => { if (data) await cleanFixture(db, data); await db.$disconnect(); await serviceDb.$disconnect(); });
async function prepared(phase: "collecting" | "paused" | "voting" | "final" | "closed" = "collecting") {
  const prior = await createSession(data.alice.id, { teamId: data.alpha.id, title: "Earlier administration commitment" });
  await db.teamSession.update({ where: { id: prior.id }, data: { createdAt: new Date("2025-01-01") } });
  const priorAction = await createAction(data.alice.id, { sessionId: prior.id, title: "Prior commitment", context: "Keep",
    ownerId: data.alice.id, dueDate: "" });
  const session = await createFacilitatedSession(data.alice.id, { teamId: data.alpha.id, title: "Administration meeting" });
  await joinSession(data.bob.id, { sessionId: session.id });
  const topics = [];
  for (let i = 0; i < 3; i++) topics.push(await createTopic(i === 1 ? data.bob.id : data.alice.id,
    { sessionId: session.id, title: `Admin topic ${i}`, description: "Preserved context" }));
  const action = await createAction(data.alice.id, { sessionId: session.id, title: "Owned commitment", context: "Keep",
    ownerId: data.alice.id, dueDate: "2026-11-01" });
  let version = 0;
  if (phase !== "collecting") await changeCollection(data.alice.id, { sessionId: session.id, state: "PAUSED", version: version++ });
  if (["voting", "final", "closed"].includes(phase)) await startVoting(data.alice.id, { sessionId: session.id, version: version++ });
  if (["final", "closed"].includes(phase)) await finalizeVoting(data.alice.id, { sessionId: session.id, version: version++ });
  if (phase === "closed") await changeCollection(data.alice.id, { sessionId: session.id, state: "CLOSED", version: version++ });
  return { sessionId: session.id, topics, action, priorAction, version };
}
const admin = (sessionId: string, version: number, operation: "transfer" | "remove" | "readmit", targetId = data.bob.id, actor = data.alice.id) =>
  administerSession(actor, { sessionId, targetId, version, ...(operation === "remove" ? { reason: "  Keep removal reason  " } : {}) }, operation);
const events = (sessionId: string) => db.sessionAdministrationEvent.findMany({ where: { sessionId }, orderBy: { version: "asc" } });

it("RM2: transfers one running session without changing its clock/contributions; only the new facilitator controls it", async () => {
  const { sessionId, version, topics } = await prepared("final");
  await controlDiscussion(data.alice.id, { sessionId, topicId: topics[0].id, version }, "start");
  const clock = await db.topicDiscussion.findFirstOrThrow({ where: { sessionId } });
  const agenda = await db.agendaEntry.findMany({ where: { sessionId } });
  const actions = await db.action.findMany({ where: { sourceSessionId: sessionId } });
  await admin(sessionId, version + 1, "transfer");
  expect(await db.topicDiscussion.findFirstOrThrow({ where: { sessionId } })).toEqual(clock);
  expect(await db.agendaEntry.findMany({ where: { sessionId } })).toEqual(agenda);
  expect(await db.action.findMany({ where: { sourceSessionId: sessionId } })).toEqual(actions);
  expect((await sessionSnapshot(data.alice.id, sessionId))).toMatchObject({ joined: true, facilitatorView: false, facilitator: { id: data.bob.id } });
  expect((await sessionSnapshot(data.bob.id, sessionId))).toMatchObject({ joined: true, facilitatorView: true });
  await expect(controlDiscussion(data.alice.id, { sessionId, topicId: topics[0].id, version: version + 2 }, "pause")).rejects.toMatchObject({ kind: "denied" });
  await controlDiscussion(data.bob.id, { sessionId, topicId: topics[0].id, version: version + 2 }, "pause");
  expect(await events(sessionId)).toMatchObject([{ kind: "TRANSFER", actorId: data.alice.id, targetId: data.bob.id, version: version + 2, reason: "" }]);
});
it("RM2: former facilitator retains ordinary contribution rights, not moderation of other authors", async () => {
  const { sessionId, topics } = await prepared();
  await admin(sessionId, 0, "transfer");
  await createTopic(data.alice.id, { sessionId, title: "Ordinary contribution", description: "" });
  await expect(changeTopic(data.alice.id, { sessionId, topicId: topics[1].id, title: "Forged edit", description: "", version: 0 }))
    .rejects.toMatchObject({ kind: "denied" });
  await admin(sessionId, 1, "transfer", data.alice.id, data.bob.id);
  expect((await db.teamSession.findUniqueOrThrow({ where: { id: sessionId } })).facilitatorId).toBe(data.alice.id);
  expect(await events(sessionId)).toHaveLength(2);
});
it("RM3: removed user cannot self-rejoin or use ANY existing write path, but remains an authorized reader", async () => {
  const { sessionId, topics, priorAction } = await prepared();
  await admin(sessionId, 0, "remove");
  const actor = data.bob.id;
  const operations = [
    () => joinSession(actor, { sessionId }),
    () => createTopic(actor, { sessionId, title: "Denied", description: "" }),
    () => changeTopic(actor, { sessionId, topicId: topics[1].id, title: "Denied", description: "", version: 0 }),
    () => changeTopic(actor, { sessionId, topicId: topics[1].id, version: 0 }, true),
    () => changeCollection(actor, { sessionId, state: "PAUSED", version: 1 }),
    () => createAction(actor, { sessionId, title: "Denied", context: "", ownerId: actor, dueDate: "" }),
    () => reviewAction(actor, { sessionId, actionId: priorAction.id, note: "Denied", status: "IN_PROGRESS" }),
    () => startVoting(actor, { sessionId, version: 1 }), () => finalizeVoting(actor, { sessionId, version: 1 }),
    () => setTopicVote(actor, { sessionId, topicId: topics[0].id, selected: false, version: 0 }),
    ...(["start", "pause", "resume", "extend", "finish"] as const).map(operation =>
      () => controlDiscussion(actor, { sessionId, topicId: topics[0].id, version: 1 }, operation)),
    ...(["park", "restore"] as const).map(operation =>
      () => controlParking(actor, { sessionId, topicId: topics[0].id, version: 1 }, operation)),
    () => moveAgendaTopic(actor, { sessionId, topicId: topics[0].id, neighborTopicId: topics[1].id, version: 1, direction: "later" }),
    () => admin(sessionId, 1, "transfer", data.alice.id, actor)
  ];
  for (const operation of operations) await expect(operation()).rejects.toMatchObject({ kind: "denied" });
  expect(await sessionSnapshot(actor, sessionId)).toMatchObject({ joined: false, administration: { viewerState: "REMOVED", canJoin: false } });
  expect(await db.topic.count({ where: { sessionId } })).toBe(3);
  expect(await events(sessionId)).toHaveLength(1);
});
it("RM4: repeated readmission preserves original join/ballot/version, selected votes and used budget", async () => {
  const { sessionId, version, topics } = await prepared("voting");
  const key = { sessionId_userId: { sessionId, userId: data.bob.id } };
  await setTopicVote(data.bob.id, { sessionId, topicId: topics[0].id, selected: true, version: 0 });
  await setTopicVote(data.bob.id, { sessionId, topicId: topics[1].id, selected: true, version: 1 });
  const original = await db.sessionParticipant.findUniqueOrThrow({ where: key });
  await admin(sessionId, version, "remove");
  expect((await sessionSnapshot(data.bob.id, sessionId)).voting).toMatchObject({ canVote: false, remaining: 1, ballotVersion: 2 });
  await expect(setTopicVote(data.bob.id, { sessionId, topicId: topics[0].id, selected: false, version: 2 })).rejects.toMatchObject({ kind: "denied" });
  await admin(sessionId, version + 1, "readmit");
  expect(await db.sessionParticipant.findUniqueOrThrow({ where: key })).toEqual(original);
  await setTopicVote(data.bob.id, { sessionId, topicId: topics[2].id, selected: true, version: 2 });
  await admin(sessionId, version + 2, "remove");
  await admin(sessionId, version + 3, "readmit");
  const view = await sessionSnapshot(data.bob.id, sessionId);
  expect(view.voting).toMatchObject({ canVote: true, remaining: 0, ballotVersion: 3 });
  expect(view.voting.selectedTopicIds).toHaveLength(3);
  expect((await db.sessionParticipant.findUniqueOrThrow({ where: key })).joinedAt).toEqual(original.joinedAt);
  expect(await events(sessionId)).toMatchObject([{ reason: "Keep removal reason" }, { reason: "" }, { reason: "Keep removal reason" }, { reason: "" }]);
});
it("RM1: denies self, missing/nonjoined/foreign targets, other roles, stale revisions, forged fields and legacy/Closed operations", async () => {
  const { sessionId } = await prepared();
  for (const operation of ["transfer", "remove", "readmit"] as const) {
    await expect(admin(sessionId, 0, operation, data.alice.id)).rejects.toMatchObject({ kind: "validation" });
    await expect(admin(sessionId, 0, operation, "missing")).rejects.toMatchObject({ kind: "denied" });
    await expect(admin(sessionId, 0, operation, data.alice.id, data.bob.id)).rejects.toMatchObject({ kind: "denied" });
  }
  await expect(admin(sessionId, 9, "transfer")).rejects.toMatchObject({ kind: "conflict" });
  await expect(admin(sessionId, 0, "readmit")).rejects.toMatchObject({ kind: "conflict" });
  await expect(administerSession(data.alice.id, { sessionId, targetId: data.bob.id, version: 0, actorId: data.alice.id }, "transfer")).rejects.toMatchObject({ kind: "validation" });
  const unjoined = await createFacilitatedSession(data.alice.id, { teamId: data.alpha.id, title: "Unjoined target" });
  await expect(admin(unjoined.id, 0, "transfer")).rejects.toMatchObject({ kind: "denied" });
  const foreign = await createFacilitatedSession(data.bob.id, { teamId: data.beta.id, title: "Foreign session" });
  await expect(admin(foreign.id, 0, "remove")).rejects.toMatchObject({ kind: "denied" });
  const legacy = await createSession(data.alice.id, { teamId: data.alpha.id, title: "Legacy administration" });
  await expect(admin(legacy.id, 0, "transfer")).rejects.toMatchObject({ kind: "conflict" });
  const closed = await prepared("closed");
  for (const operation of ["transfer", "remove", "readmit"] as const) await expect(admin(closed.sessionId, closed.version, operation)).rejects.toMatchObject({ kind: "conflict" });
  expect(await events(sessionId)).toHaveLength(0);
});
it("RM5: real queued competing changes retain one event, and removal blocks the queued participant write", async () => {
  const first = await prepared();
  const changes = await queuedSession(db, first.sessionId, [() => admin(first.sessionId, 0, "remove"), () => admin(first.sessionId, 0, "remove")]);
  expect(changes.filter(item => item.status === "fulfilled")).toHaveLength(1);
  expect(changes.filter(item => item.status === "rejected")).toEqual([expect.objectContaining({ reason: expect.objectContaining({ kind: "conflict" }) })]);
  const next = await prepared();
  const results = await queuedSession(db, next.sessionId, [
    () => admin(next.sessionId, 0, "remove"),
    () => createTopic(data.bob.id, { sessionId: next.sessionId, title: "Queued denied write", description: "" })
  ]);
  expect(results.map(item => item.status)).toEqual(["fulfilled", "rejected"]);
  expect(results[1]).toMatchObject({ reason: { kind: "denied" } });
  expect(await events(next.sessionId)).toHaveLength(1);
});
it("RM1/5: queued target membership revocation denies administration without any partial state", async () => {
  const { sessionId } = await prepared();
  const results = await queuedSession(db, sessionId, [() => admin(sessionId, 0, "transfer")], async blocker => {
    await blocker.query(`DELETE FROM "Membership" WHERE "teamId"=$1 AND "userId"=$2`, [data.alpha.id, data.bob.id]);
  });
  try {
    expect(results).toEqual([expect.objectContaining({ status: "rejected", reason: expect.objectContaining({ kind: "denied" }) })]);
    expect(await events(sessionId)).toHaveLength(0);
    expect((await db.teamSession.findUniqueOrThrow({ where: { id: sessionId } })).facilitatorId).toBe(data.alice.id);
  } finally { await db.membership.create({ data: { teamId: data.alpha.id, userId: data.bob.id } }); }
});
it("RM5: actual after-event failure rolls back role/removal, event and revision without touching clocks", async () => {
  const { sessionId } = await prepared();
  const before = await db.teamSession.findUniqueOrThrow({ where: { id: sessionId } });
  await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION teampulse_test_reject_administration() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW."sessionId"=TG_ARGV[0] THEN RAISE EXCEPTION 'Injected administration failure'; END IF; RETURN NEW; END; $$`);
  let created = false;
  try {
    await db.$executeRawUnsafe(`CREATE TRIGGER teampulse_test_reject_administration AFTER INSERT ON "SessionAdministrationEvent"
      FOR EACH ROW EXECUTE FUNCTION teampulse_test_reject_administration('${sessionId}')`);
    created = true;
    for (const operation of ["transfer", "remove"] as const) await expect(admin(sessionId, 0, operation)).rejects.toThrow(/Injected administration failure/);
  } finally {
    if (created) await db.$executeRawUnsafe(`DROP TRIGGER teampulse_test_reject_administration ON "SessionAdministrationEvent"`);
    await db.$executeRawUnsafe(`DROP FUNCTION teampulse_test_reject_administration()`);
  }
  expect(await db.teamSession.findUniqueOrThrow({ where: { id: sessionId } })).toEqual(before);
  expect((await db.sessionParticipant.findUniqueOrThrow({ where: { sessionId_userId: { sessionId, userId: data.bob.id } } })).removedAt).toBeNull();
  expect(await events(sessionId)).toHaveLength(0);
});
it("RM7: Closed summary retains historical joined roster, freezes administration and requires an active facilitator", async () => {
  const { sessionId } = await prepared();
  await admin(sessionId, 0, "remove");
  await changeCollection(data.alice.id, { sessionId, state: "CLOSED", version: 1 });
  await generateMeetingSummary(data.alice.id, { sessionId, version: 2 });
  const report = (await sessionSnapshot(data.alice.id, sessionId)).summary.report;
  expect(report?.content.participants.map(item => item.id)).toContain(data.bob.id);
  expect((await sessionSnapshot(data.bob.id, sessionId)).participants.map(item => item.id)).not.toContain(data.bob.id);
  const other = await prepared();
  await admin(other.sessionId, 0, "transfer");
  await admin(other.sessionId, 1, "remove", data.alice.id, data.bob.id);
  expect((await sessionSnapshot(data.bob.id, sessionId)).summary.report).toEqual(report);
  const removed = await prepared("closed");
  await db.sessionParticipant.update({ where: { sessionId_userId: { sessionId: removed.sessionId, userId: data.alice.id } }, data: { removedAt: new Date() } });
  await expect(generateMeetingSummary(data.alice.id, { sessionId: removed.sessionId, version: removed.version })).rejects.toMatchObject({ kind: "denied" });
});
it("RM1/5: reason boundaries, invalid operations, exhausted revisions and target-state conflicts leave no partial changes", async () => {
  const { sessionId } = await prepared();
  for (const input of [
    { sessionId, targetId: data.bob.id, version: 0, reason: "x".repeat(4001) },
    { sessionId, targetId: data.bob.id, version: -1 }, { sessionId, targetId: data.bob.id, version: 0.5 }
  ]) await expect(administerSession(data.alice.id, input, "remove")).rejects.toMatchObject({ kind: "validation" });
  await expect(administerSession(data.alice.id, { sessionId, targetId: data.bob.id, version: 0 }, "invalid" as "remove"))
    .rejects.toMatchObject({ kind: "validation" });
  await administerSession(data.alice.id, { sessionId, targetId: data.bob.id, version: 0, reason: `  ${"x".repeat(4000)}  ` }, "remove");
  expect((await events(sessionId))[0].reason).toHaveLength(4000);
  for (const operation of ["transfer", "remove"] as const) await expect(admin(sessionId, 1, operation)).rejects.toMatchObject({ kind: "conflict" });
  await admin(sessionId, 1, "readmit");
  await administerSession(data.alice.id, { sessionId, targetId: data.bob.id, version: 2, reason: "   " }, "remove");
  expect((await events(sessionId))[2].reason).toBe("");
  await db.membership.delete({ where: { teamId_userId: { teamId: data.alpha.id, userId: data.bob.id } } });
  try { await expect(admin(sessionId, 3, "readmit")).rejects.toMatchObject({ kind: "denied" }); }
  finally { await db.membership.create({ data: { teamId: data.alpha.id, userId: data.bob.id } }); }
  await db.teamSession.update({ where: { id: sessionId }, data: { lifecycleVersion: 2147483647 } });
  await expect(admin(sessionId, 2147483647, "readmit")).rejects.toMatchObject({ kind: "conflict" });
  expect(await events(sessionId)).toHaveLength(3);
});
it("RM1/2: actual queued actor revocation and competing handovers/close keep exactly one facilitator and one winning revision", async () => {
  const first = await prepared();
  await admin(first.sessionId, 0, "transfer");
  const revoked = await queuedSession(db, first.sessionId, [() => admin(first.sessionId, 1, "transfer", data.alice.id, data.bob.id)], async blocker => {
    await blocker.query(`DELETE FROM "Membership" WHERE "teamId"=$1 AND "userId"=$2`, [data.alpha.id, data.bob.id]);
  });
  try {
    expect(revoked).toMatchObject([{ status: "rejected", reason: { kind: "denied" } }]);
    expect(await events(first.sessionId)).toHaveLength(1);
  } finally { await db.membership.create({ data: { teamId: data.alpha.id, userId: data.bob.id } }); }
  const next = await prepared();
  const transferred = await queuedSession(db, next.sessionId, [
    () => admin(next.sessionId, 0, "transfer"), () => admin(next.sessionId, 0, "transfer"),
    () => changeCollection(data.alice.id, { sessionId: next.sessionId, state: "CLOSED", version: 0 })
  ]);
  expect(transferred.map(item => item.status)).toEqual(["fulfilled", "rejected", "rejected"]);
  expect(await events(next.sessionId)).toHaveLength(1);
  expect(await db.teamSession.findUniqueOrThrow({ where: { id: next.sessionId } })).toMatchObject({
    facilitatorId: data.bob.id, collectionState: "COLLECTING", lifecycleVersion: 1
  });
  const timer = await prepared("final");
  const changes = await queuedSession(db, timer.sessionId, [
    () => admin(timer.sessionId, timer.version, "transfer"),
    () => controlDiscussion(data.alice.id, { sessionId: timer.sessionId, topicId: timer.topics[0].id, version: timer.version }, "start")
  ]);
  expect(changes).toMatchObject([{ status: "fulfilled" }, { status: "rejected", reason: { kind: "denied" } }]);
  expect(await db.topicDiscussion.count({ where: { sessionId: timer.sessionId } })).toBe(0);
});
it("RM6: contradictory role/participation/capability snapshots are rejected, not silently granted", async () => {
  const { sessionId } = await prepared("voting");
  await admin(sessionId, 2, "remove");
  const view = await sessionSnapshot(data.bob.id, sessionId);
  expect(snapshotSchema.safeParse(view).success).toBe(true);
  for (const change of [
    { joined: true }, { facilitatorView: true },
    { voting: { ...view.voting, canVote: true } }, { discussion: { ...view.discussion, canExtend: true } },
    { administration: { ...view.administration, canJoin: true } },
    { administration: { ...view.administration, entries: view.administration.entries.filter(entry => entry.id !== data.bob.id) } },
    { administration: { ...view.administration, history: view.administration.history.map(event => ({ ...event, version: 99 })) } }
  ]) expect(snapshotSchema.safeParse({ ...view, ...change }).success).toBe(false);
});
