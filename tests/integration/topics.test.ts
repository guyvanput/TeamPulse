import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createFacilitatedSession, joinSession, createTopic, changeTopic, changeCollection, createAction, createSession, reviewAction } from "../../src/lib/service";
import { sessionSnapshot } from "../../src/lib/snapshot-service";
import { db as serviceDb } from "../../src/lib/db";
import { fixture, cleanFixture, testDatabase } from "../support/database";
import pg from "pg";

const db = testDatabase();
let data: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  data = await fixture(db);
  await db.membership.create({ data: { teamId: data.alpha.id, userId: data.bob.id } });
});

describe("BugMagnet service boundary gaps", () => {
  it.each([false, ""])("rejects malformed lifecycle version %j without changing state", async version => {
    const session = await create();
    await expect(changeCollection(data.alice.id, {
      sessionId: session.id, state: "PAUSED", version
    })).rejects.toMatchObject({ kind: "validation" });
    expect(await db.teamSession.findUniqueOrThrow({ where: { id: session.id } })).toEqual(session);
  });

  it("rejects a null expected removal version without removing the topic", async () => {
    const session = await create();
    const original = await topic(session.id);
    await expect(changeTopic(data.alice.id, {
      sessionId: session.id, topicId: original.id, version: null
    }, true)).rejects.toMatchObject({ kind: "validation" });
    expect(await db.topic.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
  });

  it("rejects a null expected lifecycle version without changing collection state", async () => {
    const session = await create();
    await expect(changeCollection(data.alice.id, {
      sessionId: session.id, state: "PAUSED", version: null
    })).rejects.toMatchObject({ kind: "validation" });
    expect(await db.teamSession.findUniqueOrThrow({ where: { id: session.id } })).toEqual(session);
  });

  it("rejects a null expected topic version without changing topic content", async () => {
    const session = await create();
    const original = await topic(session.id);
    await expect(changeTopic(data.alice.id, {
      sessionId: session.id, topicId: original.id, version: null, title: "No explicit version", description: ""
    })).rejects.toMatchObject({ kind: "validation" });
    expect(await db.topic.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
  });

  it("keeps duplicate titles distinct and preserves creation order when a topic is edited", async () => {
    const session = await create();
    await joinSession(data.bob.id, { sessionId: session.id });
    const first = await topic(session.id);
    const second = await topic(session.id, data.bob.id);
    expect(first.id).not.toBe(second.id);
    expect(first.title).toBe(second.title);
    const tiedAt = new Date("2026-01-02");
    await db.topic.updateMany({ where: { sessionId: session.id }, data: { createdAt: tiedAt } });
    const expectedOrder = [first.id, second.id].sort();
    expect((await sessionSnapshot(data.alice.id, session.id)).topics.map(item => item.id)).toEqual(expectedOrder);
    await changeTopic(data.alice.id, {
      sessionId: session.id, topicId: first.id, version: 0, title: "Edited duplicate", description: "New"
    });
    const saved = await db.topic.findUniqueOrThrow({ where: { id: first.id } });
    expect(saved).toMatchObject({
      authorId: data.alice.id, createdAt: tiedAt, title: "Edited duplicate", description: "New", version: 1
    });
    expect(await db.topic.findUniqueOrThrow({ where: { id: second.id } }))
      .toEqual({ ...second, createdAt: tiedAt, updatedAt: expect.any(Date) });
    expect((await sessionSnapshot(data.alice.id, session.id)).topics.map(item => item.id)).toEqual(expectedOrder);
  });

  it("accepts valid commands after rejected stale or invalid commands without partial writes", async () => {
    const session = await create();
    const original = await topic(session.id);
    const input = { sessionId: session.id, topicId: original.id, version: 0, title: "First edit", description: "Saved" };
    await changeTopic(data.alice.id, input);
    const edited = await db.topic.findUniqueOrThrow({ where: { id: original.id } });
    await expect(changeTopic(data.alice.id, { ...input, title: "Stale edit" }))
      .rejects.toMatchObject({ kind: "conflict" });
    await expect(changeTopic(data.alice.id, { ...input, version: 1, title: " " }))
      .rejects.toMatchObject({ kind: "validation" });
    expect(await db.topic.findUniqueOrThrow({ where: { id: original.id } })).toEqual(edited);
    await changeTopic(data.alice.id, { ...input, version: 1, title: "Recovered edit" });
    expect(await db.topic.findUniqueOrThrow({ where: { id: original.id } }))
      .toEqual({ ...edited, title: "Recovered edit", version: 2, updatedAt: expect.any(Date) });
    await changeCollection(data.alice.id, { sessionId: session.id, state: "PAUSED", version: 0 });
    await expect(changeCollection(data.alice.id, { sessionId: session.id, state: "COLLECTING", version: 0 }))
      .rejects.toMatchObject({ kind: "conflict" });
    const resumed = await changeCollection(data.alice.id, { sessionId: session.id, state: "COLLECTING", version: 1 });
    expect(resumed).toMatchObject({ collectionState: "COLLECTING", lifecycleVersion: 2, closedAt: null });
  });

  it("allows action capture and review while paused but rejects every topic mutation", async () => {
    const source = await createSession(data.alice.id, { teamId: data.alpha.id, title: "Earlier source" });
    await db.teamSession.update({ where: { id: source.id }, data: { createdAt: new Date("2026-01-01") } });
    const earlier = await createAction(data.alice.id, {
      sessionId: source.id, title: "Earlier action", context: "", ownerId: data.alice.id, dueDate: ""
    });
    const session = await create();
    const original = await topic(session.id);
    await changeCollection(data.alice.id, { sessionId: session.id, version: 0, state: "PAUSED" });
    await expect(topic(session.id)).rejects.toMatchObject({ kind: "conflict", message: "Topic collection is paused." });
    for (const remove of [false, true]) {
      await expect(changeTopic(data.alice.id, {
        sessionId: session.id, topicId: original.id, version: 0, title: "Blocked", description: ""
      }, remove)).rejects.toMatchObject({ kind: "conflict", message: "Topic collection is paused." });
    }
    const captured = await createAction(data.alice.id, {
      sessionId: session.id, title: "Paused capture", context: "Keep", ownerId: data.alice.id, dueDate: ""
    });
    expect(await db.action.findUniqueOrThrow({ where: { id: captured.id } })).toMatchObject({
      sourceSessionId: session.id, title: "Paused capture", context: "Keep", status: "OPEN"
    });
    const review = await reviewAction(data.alice.id, {
      sessionId: session.id, actionId: earlier.id, note: "Progress while paused", status: "IN_PROGRESS"
    });
    expect(review).toMatchObject({
      reviewSessionId: session.id, actionId: earlier.id, actorId: data.alice.id,
      note: "Progress while paused", resultingStatus: "IN_PROGRESS"
    });
    expect((await db.action.findUniqueOrThrow({ where: { id: earlier.id } })).status).toBe("IN_PROGRESS");
    expect(await db.topic.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
  });

  it("rejects repeated lifecycle commands and closed-session reviews without changing history", async () => {
    const source = await createSession(data.alice.id, { teamId: data.alpha.id, title: "Closed review source" });
    await db.teamSession.update({ where: { id: source.id }, data: { createdAt: new Date("2026-01-01") } });
    const action = await createAction(data.alice.id, {
      sessionId: source.id, title: "Unchanged action", context: "", ownerId: data.alice.id, dueDate: ""
    });
    const session = await create();
    await changeCollection(data.alice.id, { sessionId: session.id, version: 0, state: "PAUSED" });
    for (const version of [0, 1]) {
      await expect(changeCollection(data.alice.id, { sessionId: session.id, version, state: "PAUSED" }))
        .rejects.toMatchObject({ kind: "conflict" });
    }
    const closed = await changeCollection(data.alice.id, { sessionId: session.id, version: 1, state: "CLOSED" });
    expect(closed).toMatchObject({ collectionState: "CLOSED", lifecycleVersion: 2, closedAt: expect.any(Date) });
    for (const state of ["COLLECTING", "PAUSED", "CLOSED"]) {
      await expect(changeCollection(data.alice.id, { sessionId: session.id, version: 2, state }))
        .rejects.toMatchObject({ kind: "conflict", message: "This session is closed and read-only." });
    }
    await expect(reviewAction(data.alice.id, {
      sessionId: session.id, actionId: action.id, note: "Blocked review", status: "DONE"
    })).rejects.toMatchObject({ kind: "conflict", message: "This session is closed and read-only." });
    await expect(joinSession(data.alice.id, { sessionId: session.id }))
      .rejects.toMatchObject({ kind: "conflict" });
    expect(await db.teamSession.findUniqueOrThrow({ where: { id: session.id } })).toEqual(closed);
    expect(await db.action.findUniqueOrThrow({ where: { id: action.id } })).toEqual(action);
    expect(await db.actionReview.count({ where: { reviewSessionId: session.id } })).toBe(0);
    expect(await db.sessionParticipant.count({ where: { sessionId: session.id } })).toBe(1);
  });

  it("denies a revoked facilitator's session controls and topic mutations despite retained historical roles", async () => {
    const session = await createFacilitatedSession(data.bob.id, { teamId: data.beta.id, title: "Revoked facilitator" });
    const original = await topic(session.id, data.bob.id);
    await db.membership.delete({ where: { teamId_userId: { teamId: data.beta.id, userId: data.bob.id } } });
    try {
      await expect(changeCollection(data.bob.id, { sessionId: session.id, version: 0, state: "CLOSED" }))
        .rejects.toMatchObject({ kind: "denied" });
      await expect(topic(session.id, data.bob.id)).rejects.toMatchObject({ kind: "denied" });
      for (const remove of [false, true]) {
        await expect(changeTopic(data.bob.id, {
          sessionId: session.id, topicId: original.id, version: 0, title: "No access", description: ""
        }, remove)).rejects.toMatchObject({ kind: "denied" });
      }
      expect(await db.teamSession.findUniqueOrThrow({ where: { id: session.id } })).toEqual(session);
      expect(await db.topic.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
      expect(await db.sessionParticipant.count({ where: { sessionId: session.id, userId: data.bob.id } })).toBe(1);
    } finally {
      await db.membership.create({ data: { teamId: data.beta.id, userId: data.bob.id } });
    }
  });

  it("rejects null and missing command payloads without writing session data", async () => {
    const session = await create();
    const original = await topic(session.id);
    const before = await db.teamSession.count({ where: { teamId: data.alpha.id } });
    const commands = [
      createFacilitatedSession, joinSession, createTopic, changeTopic, changeCollection
    ];
    for (const command of commands) {
      for (const input of [null, undefined, {}]) {
        await expect(command(data.alice.id, input)).rejects.toMatchObject({ kind: "validation" });
      }
    }
    expect(await db.teamSession.count({ where: { teamId: data.alpha.id } })).toBe(before);
    expect(await db.topic.findMany({ where: { sessionId: session.id } })).toEqual([original]);
    expect(await db.teamSession.findUniqueOrThrow({ where: { id: session.id } })).toEqual(session);
  });

  it("rejects invalid topic text at the service boundary without partial writes", async () => {
    const session = await create();
    const original = await topic(session.id);
    const changes = [
      { title: "" }, { title: " \t\n " }, { title: "a".repeat(161) },
      { title: "😀".repeat(81) }, { title: null }, { title: 1 },
      { description: "a".repeat(4001) }, { description: null }
    ];
    for (const change of changes) {
      const input = { sessionId: session.id, title: "Valid", description: "", ...change };
      await expect(createTopic(data.alice.id, input)).rejects.toMatchObject({ kind: "validation" });
      await expect(changeTopic(data.alice.id, { ...input, topicId: original.id, version: 0 }))
        .rejects.toMatchObject({ kind: "validation" });
    }
    expect(await db.topic.findMany({ where: { sessionId: session.id } })).toEqual([original]);
  });

  it("rejects missing, nonnumeric, negative and fractional versions without mutation", async () => {
    const session = await create();
    const original = await topic(session.id);
    for (const version of [undefined, "invalid", -1, 0.5, Infinity, NaN]) {
      await expect(changeCollection(data.alice.id, { sessionId: session.id, state: "PAUSED", version }))
        .rejects.toMatchObject({ kind: "validation" });
      for (const remove of [false, true]) {
        await expect(changeTopic(data.alice.id, {
          sessionId: session.id, topicId: original.id, version, title: "No", description: ""
        }, remove)).rejects.toMatchObject({ kind: "validation" });
      }
    }
    expect(await db.topic.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
    expect(await db.teamSession.findUniqueOrThrow({ where: { id: session.id } })).toEqual(session);
  });

  it("uses authenticated identities rather than forged creation fields", async () => {
    const session = await createFacilitatedSession(data.alice.id, {
      teamId: data.alpha.id, title: "Identity boundary", facilitatorId: data.bob.id,
      kind: "ACTION_FOLLOW_UP", collectionState: "CLOSED"
    });
    expect(session).toMatchObject({
      teamId: data.alpha.id, facilitatorId: data.alice.id, kind: "FACILITATED",
      collectionState: "COLLECTING", lifecycleVersion: 0, closedAt: null
    });
    expect(await db.sessionParticipant.findMany({ where: { sessionId: session.id } }))
      .toEqual([expect.objectContaining({ teamId: data.alpha.id, userId: data.alice.id })]);
    const saved = await createTopic(data.alice.id, {
      sessionId: session.id, title: "  Identity  ", description: "  Context  ",
      authorId: data.bob.id, teamId: data.beta.id, version: 99,
      removedAt: new Date(), removedById: data.bob.id
    });
    expect(saved).toMatchObject({
      title: "Identity", description: "Context", authorId: data.alice.id,
      teamId: data.alpha.id, sessionId: session.id, version: 0,
      removedAt: null, removedById: null
    });
  });

  it("rejects foreign-session and nonexistent topic identities without changing either session", async () => {
    const source = await create();
    const other = await create();
    const original = await topic(source.id);
    for (const topicId of [original.id, "nonexistent-topic"]) {
      for (const remove of [false, true]) {
        await expect(changeTopic(data.alice.id, {
          sessionId: other.id, topicId, version: 0, title: "Wrong session", description: ""
        }, remove)).rejects.toMatchObject({ kind: "denied", message: "Topic not found or access denied." });
      }
    }
    expect(await db.topic.findMany({ where: { sessionId: source.id } })).toEqual([original]);
    expect(await db.topic.count({ where: { sessionId: other.id } })).toBe(0);
  });

  it("preserves topic identity and history despite forged update and removal fields", async () => {
    const session = await create();
    await joinSession(data.bob.id, { sessionId: session.id });
    const original = await topic(session.id, data.bob.id);
    const forged = {
      sessionId: session.id, topicId: original.id, version: 0, title: "Changed", description: "Saved",
      authorId: data.alice.id, teamId: data.beta.id, createdAt: new Date("2000-01-01"),
      removedById: data.bob.id, removedAt: new Date("2000-01-01")
    };
    await changeTopic(data.alice.id, forged);
    const edited = await db.topic.findUniqueOrThrow({ where: { id: original.id } });
    expect(edited).toEqual({
      ...original, title: "Changed", description: "Saved", version: 1, updatedAt: expect.any(Date)
    });
    await changeTopic(data.alice.id, { ...forged, version: 1 }, true);
    const removed = await db.topic.findUniqueOrThrow({ where: { id: original.id } });
    expect(removed).toEqual({
      ...edited, version: 2, removedById: data.alice.id,
      removedAt: expect.any(Date), updatedAt: expect.any(Date)
    });
    await expect(changeTopic(data.alice.id, { ...forged, version: 2 }, true))
      .rejects.toMatchObject({ kind: "conflict" });
    expect(await db.topic.findUniqueOrThrow({ where: { id: original.id } })).toEqual(removed);
  });
});
afterAll(async () => {
  if (data) await cleanFixture(db, data);
  await Promise.all([db.$disconnect(), serviceDb.$disconnect()]);
});
const create = () => createFacilitatedSession(data.alice.id, { teamId: data.alpha.id, title: "Collect ideas" });
const topic = (sessionId: string, actor = data.alice.id) => createTopic(actor, { sessionId, title: "Improve flow", description: "Original context" });

describe("TC1-TC11 facilitated services", () => {
  it("creates creator/roster atomically; legacy behavior remains available", async () => {
    const session = await create();
    expect(session).toMatchObject({ kind: "FACILITATED", facilitatorId: data.alice.id, collectionState: "COLLECTING" });
    expect(await db.sessionParticipant.count({ where: { sessionId: session.id } })).toBe(1);
    const legacy = await createSession(data.alice.id, { teamId: data.alpha.id, title: "Legacy" });
    expect(legacy).toMatchObject({ kind: "ACTION_FOLLOW_UP", facilitatorId: null, collectionState: null });
  });
  it("allows reading before joining but rejects contributions until joined", async () => {
    const session = await create();
    expect((await sessionSnapshot(data.bob.id, session.id)).joined).toBe(false);
    await expect(topic(session.id, data.bob.id)).rejects.toThrow("Join");
    await expect(createAction(data.bob.id, { sessionId: session.id, title: "Not joined", context: "", ownerId: data.bob.id, dueDate: "" })).rejects.toThrow("Join");
    await Promise.all([joinSession(data.bob.id, { sessionId: session.id }), joinSession(data.bob.id, { sessionId: session.id })]);
    expect(await db.sessionParticipant.count({ where: { sessionId: session.id } })).toBe(2);
    await topic(session.id, data.bob.id);
    await expect(changeCollection(data.bob.id, { sessionId: session.id, state: "PAUSED", version: 0 })).rejects.toThrow("facilitator");
  });
  it("denies anonymous and foreign-team access without leaking data", async () => {
    const session = await create();
    await expect(sessionSnapshot("", session.id)).rejects.toThrow("denied");
    const foreign = await createFacilitatedSession(data.bob.id, { teamId: data.beta.id, title: "Foreign" });
    await expect(sessionSnapshot(data.alice.id, foreign.id)).rejects.toThrow("denied");
    await expect(joinSession(data.alice.id, { sessionId: foreign.id })).rejects.toThrow("denied");
  });
  it("enforces author permissions, preserves removal history, and rejects stale versions", async () => {
    const session = await create();
    await joinSession(data.bob.id, { sessionId: session.id });
    const original = await topic(session.id);
    const input = { sessionId: session.id, topicId: original.id, version: 0, title: "Edited", description: "Updated" };
    await expect(changeTopic(data.bob.id, input)).rejects.toThrow("author");
    await changeTopic(data.alice.id, input);
    await expect(changeTopic(data.alice.id, input)).rejects.toThrow("changed");
    await changeTopic(data.alice.id, { ...input, version: 1 }, true);
    const saved = (await sessionSnapshot(data.alice.id, session.id)).topics[0];
    expect(saved).toMatchObject({ title: "Edited", version: 2, removedBy: { id: data.alice.id } });
    expect(saved.removedAt).not.toBeNull();
    await expect(changeTopic(data.alice.id, { ...input, version: 2 })).rejects.toThrow("removed");
  });
  it("facilitator can edit participants' topics, not authorship", async () => {
    const session = await create();
    await joinSession(data.bob.id, { sessionId: session.id });
    const original = await topic(session.id, data.bob.id);
    await changeTopic(data.alice.id, { sessionId: session.id, topicId: original.id, version: 0, title: "Facilitated", description: "" });
    expect((await db.topic.findUniqueOrThrow({ where: { id: original.id } })).authorId).toBe(data.bob.id);
  });
  it("pauses/resumes and makes closed sessions immutable without completing actions", async () => {
    const session = await create();
    const action = await createAction(data.alice.id, { sessionId: session.id, title: "Carry forward", context: "Keep", ownerId: data.alice.id, dueDate: "" });
    await changeCollection(data.alice.id, { sessionId: session.id, state: "PAUSED", version: 0 });
    await expect(topic(session.id)).rejects.toThrow("paused");
    await joinSession(data.bob.id, { sessionId: session.id });
    await expect(changeCollection(data.alice.id, { sessionId: session.id, state: "COLLECTING", version: 0 })).rejects.toThrow("changed");
    await changeCollection(data.alice.id, { sessionId: session.id, state: "COLLECTING", version: 1 });
    await changeCollection(data.alice.id, { sessionId: session.id, state: "CLOSED", version: 2 });
    await expect(topic(session.id)).rejects.toThrow("closed");
    await expect(joinSession(data.bob.id, { sessionId: session.id })).rejects.toThrow("closed");
    await expect(createAction(data.alice.id, { sessionId: session.id, title: "No", context: "", ownerId: data.alice.id, dueDate: "" })).rejects.toThrow("closed");
    expect((await db.action.findUniqueOrThrow({ where: { id: action.id } })).status).toBe("OPEN");
    const later = await create();
    await reviewAction(data.alice.id, { sessionId: later.id, actionId: action.id, note: "Completed later", status: "DONE" });
    expect((await sessionSnapshot(data.alice.id, later.id)).reviews[0].note).toBe("Completed later");
  });
  it("current membership is required even with persisted facilitator/participant records", async () => {
    const session = await create();
    await joinSession(data.bob.id, { sessionId: session.id });
    await db.membership.delete({ where: { teamId_userId: { teamId: data.alpha.id, userId: data.bob.id } } });
    try {
      await expect(topic(session.id, data.bob.id)).rejects.toThrow("denied");
      await expect(sessionSnapshot(data.bob.id, session.id)).rejects.toThrow("denied");
      expect(await db.sessionParticipant.count({ where: { sessionId: session.id, userId: data.bob.id } })).toBe(1);
    } finally { await db.membership.create({ data: { teamId: data.alpha.id, userId: data.bob.id } }); }
  });
  it.each([false, true])("serializes edit versus remove=%s so exactly one expected version commits", async remove => {
    const session = await create();
    const original = await topic(session.id);
    const input = { sessionId: session.id, topicId: original.id, version: 0, title: "Competing", description: "" };
    const result = await Promise.allSettled([changeTopic(data.alice.id, input), changeTopic(data.alice.id, input, remove)]);
    expect(result.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(result.filter(item => item.status === "rejected")).toHaveLength(1);
    expect((await db.topic.findUniqueOrThrow({ where: { id: original.id } })).version).toBe(1);
  });

  it("TC3/TC7: a queued contribution is denied when membership revocation commits first", async () => {
    const session = await create();
    await joinSession(data.bob.id, { sessionId: session.id });
    const blocker = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await blocker.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      const { rows } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await blocker.query(`DELETE FROM "Membership" WHERE "teamId"=$1 AND "userId"=$2`, [data.alpha.id, data.bob.id]);
      pending = topic(session.id, data.bob.id);
      const outcome = pending.then(() => "saved", error => error instanceof Error ? error.message : "unexpected");
      await expect.poll(async () => {
        const result = await db.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${rows[0].pid} = ANY(pg_blocking_pids(pid))) AS waiting
        `;
        return result[0].waiting;
      }).toBe(true);
      await blocker.query("COMMIT");
      expect(await outcome).toMatch(/access/);
      expect(await db.topic.count({ where: { sessionId: session.id } })).toBe(0);
    } finally {
      await blocker.query("ROLLBACK");
      await pending?.catch(() => undefined);
      await db.membership.upsert({ where: { teamId_userId: { teamId: data.alpha.id, userId: data.bob.id } }, create: { teamId: data.alpha.id, userId: data.bob.id }, update: {} });
      await blocker.end();
    }
  });

  it.each(["topic/pause", "join/close", "review/close"] as const)("TC7: queued %s rechecks committed session state", async scenario => {
    const session = await create();
    const legacy = await createSession(data.alice.id, { teamId: data.alpha.id, title: "Source" });
    await db.teamSession.update({ where: { id: legacy.id }, data: { createdAt: new Date("2026-01-01") } });
    const action = await createAction(data.alice.id, { sessionId: legacy.id, title: "Earlier", ownerId: data.alice.id, context: "", dueDate: "" });
    const blocker = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await blocker.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      const { rows } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await blocker.query(`SELECT "id" FROM "TeamSession" WHERE "id"=$1 FOR UPDATE`, [session.id]);
      await blocker.query(`UPDATE "TeamSession" SET "collectionState"=$2, "lifecycleVersion"=1, "closedAt"=$3 WHERE "id"=$1`,
        [session.id, scenario === "topic/pause" ? "PAUSED" : "CLOSED", scenario === "topic/pause" ? null : new Date()]);
      const operation = scenario === "topic/pause" ? topic(session.id)
        : scenario === "join/close" ? joinSession(data.bob.id, { sessionId: session.id })
        : reviewAction(data.alice.id, { sessionId: session.id, actionId: action.id, note: "Must not save", status: "DONE" });
      pending = operation;
      const outcome = operation.then(() => "saved", error => error instanceof Error ? error.message : "unexpected");
      await expect.poll(async () => {
        const result = await db.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${rows[0].pid} = ANY(pg_blocking_pids(pid))) AS waiting
        `;
        return result[0].waiting;
      }).toBe(true);
      await blocker.query("COMMIT");
      expect(await outcome).toMatch(scenario === "topic/pause" ? /paused/ : /closed/);
      expect(await db.topic.count({ where: { sessionId: session.id } })).toBe(0);
      expect(await db.actionReview.count({ where: { reviewSessionId: session.id } })).toBe(0);
    } finally {
      await blocker.query("ROLLBACK");
      await pending?.catch(() => undefined);
      await blocker.end();
    }
  });
});

describe("bugmagnet session 2026-10-27", () => {
  it("returns explicit conflicts for huge lifecycle versions and still accepts the current version", async () => {
    const session = await create();
    for (const version of [2147483648, Number.MAX_SAFE_INTEGER]) {
      await expect(changeCollection(data.alice.id, { sessionId: session.id, version, state: "PAUSED" }))
        .rejects.toMatchObject({ kind: "conflict", message: "Collection changed. Refresh and try again." });
    }
    expect(await db.teamSession.findUniqueOrThrow({ where: { id: session.id } })).toEqual(session);
    expect(await changeCollection(data.alice.id, { sessionId: session.id, version: 0, state: "PAUSED" }))
      .toMatchObject({ lifecycleVersion: 1, collectionState: "PAUSED" });
  });

  it("preserves rows after rejected huge topic versions and accepts a subsequent valid edit", async () => {
    const session = await create();
    const original = await topic(session.id);
    for (const remove of [false, true]) {
      await expect(changeTopic(data.alice.id, {
        sessionId: session.id, topicId: original.id, version: 2147483648, title: "Not saved", description: ""
      }, remove)).rejects.toBeInstanceOf(Error);
      expect(await db.topic.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
    }
    await changeTopic(data.alice.id, {
      sessionId: session.id, topicId: original.id, version: 0, title: "Recovered", description: "Valid save"
    });
    expect(await db.topic.findUniqueOrThrow({ where: { id: original.id } }))
      .toEqual({ ...original, title: "Recovered", description: "Valid save", version: 1, updatedAt: expect.any(Date) });
  });

  it("retains all 100 topics with stable tie ordering and no duplicate identities", async () => {
    const session = await create();
    const ids: string[] = [];
    for (let index = 0; index < 100; index++) {
      const saved = await createTopic(data.alice.id, {
        sessionId: session.id, title: `Topic ${index}`, description: `Context ${index}`
      });
      ids.push(saved.id);
    }
    await db.topic.updateMany({ where: { sessionId: session.id }, data: { createdAt: new Date("2026-01-02") } });
    const snapshot = await sessionSnapshot(data.alice.id, session.id);
    expect(snapshot.topics.map(item => item.id)).toEqual([...ids].sort());
    const byId = new Map(snapshot.topics.map(item => [item.id, item]));
    expect(ids.map(id => {
      const item = byId.get(id);
      return { title: item?.title, description: item?.description };
    })).toEqual(ids.map((_, index) => ({ title: `Topic ${index}`, description: `Context ${index}` })));
    expect(byId.size).toBe(100);
  });

  it.each([2147483648, Number.MAX_SAFE_INTEGER])("returns a conflict for out-of-range expected topic version %s without writing", async version => {
    const session = await create();
    const original = await topic(session.id);
    await expect(changeTopic(data.alice.id, {
      sessionId: session.id, topicId: original.id, version, title: "Not saved", description: ""
    })).rejects.toMatchObject({ kind: "conflict" });
    expect(await db.topic.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
  });

  it("returns a conflict for an out-of-range expected removal version without writing", async () => {
    const session = await create();
    const original = await topic(session.id);
    await expect(changeTopic(data.alice.id, {
      sessionId: session.id, topicId: original.id, version: 2147483648
    }, true)).rejects.toMatchObject({ kind: "conflict" });
    expect(await db.topic.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
  });

  it("rejects a boolean expected version after a lifecycle transition", async () => {
    const session = await create();
    const paused = await changeCollection(data.alice.id, { sessionId: session.id, version: 0, state: "PAUSED" });
    await expect(changeCollection(data.alice.id, {
      sessionId: session.id, version: true, state: "COLLECTING"
    })).rejects.toMatchObject({ kind: "validation" });
    expect(await db.teamSession.findUniqueOrThrow({ where: { id: session.id } })).toEqual(paused);
  });

  it("rejects an array expected version after a topic edit", async () => {
    const session = await create();
    const original = await topic(session.id);
    await changeTopic(data.alice.id, {
      sessionId: session.id, topicId: original.id, version: 0, title: "First edit", description: ""
    });
    const edited = await db.topic.findUniqueOrThrow({ where: { id: original.id } });
    await expect(changeTopic(data.alice.id, {
      sessionId: session.id, topicId: original.id, version: [1], title: "Array edit", description: ""
    })).rejects.toMatchObject({ kind: "validation" });
    expect(await db.topic.findUniqueOrThrow({ where: { id: original.id } })).toEqual(edited);
  });

  it("rejects a boolean expected removal version after a topic edit", async () => {
    const session = await create();
    const original = await topic(session.id);
    await changeTopic(data.alice.id, {
      sessionId: session.id, topicId: original.id, version: 0, title: "First edit", description: ""
    });
    const edited = await db.topic.findUniqueOrThrow({ where: { id: original.id } });
    await expect(changeTopic(data.alice.id, {
      sessionId: session.id, topicId: original.id, version: true
    }, true)).rejects.toMatchObject({ kind: "validation" });
    expect(await db.topic.findUniqueOrThrow({ where: { id: original.id } })).toEqual(edited);
  });

  it("accepts explicit numeric-string versions and rejects stale int32-boundary versions without writes", async () => {
    const session = await create();
    const original = await topic(session.id);
    for (const version of [2147483647, "2147483647"]) {
      await expect(changeTopic(data.alice.id, {
        sessionId: session.id, topicId: original.id, version, title: "Not saved", description: ""
      })).rejects.toMatchObject({ kind: "conflict" });
      await expect(changeCollection(data.alice.id, { sessionId: session.id, version, state: "PAUSED" }))
        .rejects.toMatchObject({ kind: "conflict" });
    }
    expect(await db.topic.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
    expect(await db.teamSession.findUniqueOrThrow({ where: { id: session.id } })).toEqual(session);
    await changeTopic(data.alice.id, {
      sessionId: session.id, topicId: original.id, version: "0", title: "Explicit version", description: ""
    });
    expect(await db.topic.findUniqueOrThrow({ where: { id: original.id } }))
      .toEqual({ ...original, title: "Explicit version", description: "", version: 1, updatedAt: expect.any(Date) });
    expect(await changeCollection(data.alice.id, { sessionId: session.id, version: "0", state: "PAUSED" }))
      .toMatchObject({ collectionState: "PAUSED", lifecycleVersion: 1 });
  });

  it("persists exact UTF-16 boundaries and distinct Unicode normalization forms as literal text", async () => {
    const session = await create();
    const boundary = await createTopic(data.alice.id, {
      sessionId: session.id, title: ` \u00a0${"😀".repeat(80)}\u00a0 `,
      description: ` \t${"😀".repeat(2000)}\n `
    });
    expect(boundary.title).toBe("😀".repeat(80));
    expect(boundary.description).toBe("😀".repeat(2000));
    const titles = ["é", "e\u0301", "RTL \u200fשלום", "<script>literal</script>", "'; SELECT 'literal'"];
    const ids: string[] = [];
    for (const title of titles) {
      const saved = await createTopic(data.alice.id, { sessionId: session.id, title, description: title });
      expect(saved).toMatchObject({ title, description: title });
      ids.push(saved.id);
    }
    expect(new Set(ids).size).toBe(titles.length);
    const saved = await db.topic.findMany({ where: { sessionId: session.id } });
    expect(saved.find(item => item.id === boundary.id)).toMatchObject({
      title: "😀".repeat(80), description: "😀".repeat(2000)
    });
    expect(ids.map(id => saved.find(item => item.id === id)?.title)).toEqual(titles);
  });

  it("preserves committed topic content when edit, pause and close commands compete", async () => {
    const session = await create();
    const original = await topic(session.id);
    const [edit, pause, close] = await Promise.allSettled([
      changeTopic(data.alice.id, {
        sessionId: session.id, topicId: original.id, version: 0, title: "Concurrent edit", description: "Committed"
      }),
      changeCollection(data.alice.id, { sessionId: session.id, version: 0, state: "PAUSED" }),
      changeCollection(data.alice.id, { sessionId: session.id, version: 0, state: "CLOSED" })
    ]);
    expect([pause, close].filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = [edit, pause, close].filter(result => result.status === "rejected");
    for (const result of rejected) {
      if (result.status === "rejected") expect(result.reason).toMatchObject({ kind: "conflict" });
    }
    const state = await db.teamSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(state.lifecycleVersion).toBe(1);
    expect(state.collectionState).toBe(pause.status === "fulfilled" ? "PAUSED" : "CLOSED");
    const saved = await db.topic.findUniqueOrThrow({ where: { id: original.id } });
    expect(saved).toEqual(edit.status === "fulfilled"
      ? { ...original, title: "Concurrent edit", description: "Committed", version: 1, updatedAt: expect.any(Date) }
      : original);
    if (state.collectionState === "PAUSED") {
      await changeCollection(data.alice.id, { sessionId: session.id, version: 1, state: "CLOSED" });
    }
    expect(await db.topic.findUniqueOrThrow({ where: { id: original.id } })).toEqual(saved);
  });
});
