import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actionDetails, createAction, createSession, listTeams, reviewAction, sessionDetails } from "../../src/lib/service";
import { db as serviceDb } from "../../src/lib/db";
import { cleanFixture, fixture, testDatabase } from "../support/database";

const db = testDatabase();
let data: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { data = await fixture(db); });
afterAll(async () => {
  if (data) await cleanFixture(db, data);
  await Promise.all([db.$disconnect(), serviceDb.$disconnect()]);
});

async function sessions() {
  const source = await createSession(data.alice.id, { teamId: data.alpha.id, title: "First discussion" });
  await db.teamSession.update({ where: { id: source.id }, data: { createdAt: new Date("2026-01-01") } });
  const later = await createSession(data.alice.id, { teamId: data.alpha.id, title: "Follow-up" });
  return { source, later };
}

async function capture(sessionId: string, title = "Improve handover") {
  return createAction(data.alice.id, { sessionId, title, ownerId: data.alice.id, context: "Original discussion", dueDate: "2026-12-01" });
}

describe("AC1/AC2/AC9 authorization", () => {
  it("denies anonymous team access and mutations", async () => {
    await expect(listTeams("")).rejects.toThrow("Sign in");
    await expect(createSession("", { teamId: data.alpha.id, title: "No" })).rejects.toThrow("access");
  });
  it("lists only the actor's teams", async () => {
    expect((await listTeams(data.alice.id)).map((team) => team.id)).toEqual([data.alpha.id]);
  });
  it("rejects foreign team session creation, reads, capture, action reads, and reviews", async () => {
    const { source, later } = await sessions();
    const action = await capture(source.id);
    await expect(createSession(data.bob.id, { teamId: data.alpha.id, title: "No" })).rejects.toThrow("access");
    await expect(sessionDetails(data.bob.id, source.id)).rejects.toThrow("denied");
    await expect(createAction(data.bob.id, { sessionId: source.id, title: "No", ownerId: data.bob.id, context: "", dueDate: "" })).rejects.toThrow("denied");
    await expect(actionDetails(data.bob.id, action.id)).rejects.toThrow("denied");
    await expect(reviewAction(data.bob.id, { sessionId: later.id, actionId: action.id, note: "No", status: "DONE" })).rejects.toThrow("denied");
    const betaSession = await createSession(data.bob.id, { teamId: data.beta.id, title: "Beta review" });
    await expect(reviewAction(data.bob.id, { sessionId: betaSession.id, actionId: action.id, note: "No", status: "DONE" })).rejects.toThrow("denied");
    expect((await db.action.findUniqueOrThrow({ where: { id: action.id } })).status).toBe("OPEN");
  });
});

describe("AC3/AC4 capture and validation", () => {
  it("persists an action with source, calendar date and initial Open status", async () => {
    const { source } = await sessions();
    const action = await capture(source.id);
    const result = await actionDetails(data.alice.id, action.id);
    expect(result.sourceSessionId).toBe(source.id);
    expect(result.status).toBe("OPEN");
    expect(result.context).toBe("Original discussion");
    expect(result.dueDate?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
  it("rejects foreign owners and malformed input without writing", async () => {
    const { source } = await sessions();
    const base = { sessionId: source.id, title: "No", ownerId: data.bob.id, context: "", dueDate: "" };
    const before = await db.action.count({ where: { teamId: data.alpha.id } });
    await expect(createAction(data.alice.id, base)).rejects.toThrow("owner");
    await expect(createAction(data.alice.id, { ...base, title: " " })).rejects.toThrow("title");
    await expect(createAction(data.alice.id, { ...base, dueDate: "2026-02-30" })).rejects.toThrow("date");
    expect(await db.action.count({ where: { teamId: data.alpha.id } })).toBe(before);
  });
});

describe("AC5 follow-up selection", () => {
  it("includes only earlier, same-team unresolved actions", async () => {
    const { source, later } = await sessions();
    const open = await capture(source.id, "Carry forward");
    const done = await capture(source.id, "Completed");
    await db.action.update({ where: { id: done.id }, data: { status: "DONE" } });
    const same = await capture(later.id, "Same session");
    const future = await createSession(data.alice.id, { teamId: data.alpha.id, title: "Future" });
    await db.teamSession.update({ where: { id: future.id }, data: { createdAt: new Date("2099-01-01") } });
    const futureAction = await capture(future.id, "Future action");
    const beta = await createSession(data.bob.id, { teamId: data.beta.id, title: "Foreign" });
    const foreign = await createAction(data.bob.id, { sessionId: beta.id, title: "Foreign", ownerId: data.bob.id, context: "", dueDate: "" });
    const ids = (await sessionDetails(data.alice.id, later.id)).priorActions.map((item) => item.id);
    expect(ids).toContain(open.id);
    for (const id of [done.id, same.id, futureAction.id, foreign.id]) expect(ids).not.toContain(id);
  });
});

describe("AC6/AC7 review consistency", () => {
  it("records actor, session and history together with status", async () => {
    const { source, later } = await sessions();
    const action = await capture(source.id);
    await reviewAction(data.alice.id, { sessionId: later.id, actionId: action.id, note: "Checklist drafted", status: "DONE" });
    const result = await actionDetails(data.alice.id, action.id);
    expect(result.status).toBe("DONE");
    expect(result.context).toBe("Original discussion");
    expect(result.reviews[0]).toMatchObject({ actorId: data.alice.id, reviewSessionId: later.id, note: "Checklist drafted" });
    expect(result.reviews[0].createdAt).toBeInstanceOf(Date);
    expect((await sessionDetails(data.alice.id, later.id)).priorActions.map((item) => item.id)).not.toContain(action.id);
  });
  it("rejects same-session review and blank notes without changing status", async () => {
    const { source, later } = await sessions();
    const action = await capture(source.id);
    await expect(reviewAction(data.alice.id, { sessionId: source.id, actionId: action.id, note: "No", status: "DONE" })).rejects.toThrow("earlier");
    await expect(reviewAction(data.alice.id, { sessionId: later.id, actionId: action.id, note: " ", status: "DONE" })).rejects.toThrow("note");
    expect((await db.action.findUniqueOrThrow({ where: { id: action.id } })).status).toBe("OPEN");
    expect(await db.actionReview.count({ where: { actionId: action.id } })).toBe(0);
  });
  it("serializes concurrent duplicate reviews without duplicate history", async () => {
    const { source, later } = await sessions();
    const action = await capture(source.id);
    const input = { sessionId: later.id, actionId: action.id, note: "Started", status: "IN_PROGRESS" };
    const results = await Promise.allSettled([reviewAction(data.alice.id, input), reviewAction(data.alice.id, input)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await db.actionReview.count({ where: { actionId: action.id } })).toBe(1);
    await expect(reviewAction(data.alice.id, { ...input, status: "DONE" })).rejects.toThrow("already reviewed");
    expect((await db.action.findUniqueOrThrow({ where: { id: action.id } })).status).toBe("IN_PROGRESS");
  });
  it("a transaction failure rolls back review and status together", async () => {
    const { source, later } = await sessions();
    const action = await capture(source.id);
    await db.$executeRawUnsafe(`CREATE FUNCTION teampulse_test_reject_status() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected status failure'; END; $$`);
    try {
      await db.$executeRawUnsafe(`CREATE TRIGGER teampulse_test_reject_status BEFORE UPDATE ON "Action" FOR EACH ROW EXECUTE FUNCTION teampulse_test_reject_status()`);
      await expect(reviewAction(data.alice.id, { sessionId: later.id, actionId: action.id, note: "Rollback", status: "DONE" })).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS teampulse_test_reject_status ON "Action"`);
      await db.$executeRawUnsafe(`DROP FUNCTION teampulse_test_reject_status()`);
    }
    expect(await db.actionReview.count({ where: { actionId: action.id } })).toBe(0);
    expect((await db.action.findUniqueOrThrow({ where: { id: action.id } })).status).toBe("OPEN");
  });
  it("serializes completion across different review sessions", async () => {
    const { source, later } = await sessions();
    const another = await createSession(data.alice.id, { teamId: data.alpha.id, title: "Another follow-up" });
    const action = await capture(source.id);
    const result = await Promise.allSettled([later, another].map((session) =>
      reviewAction(data.alice.id, { sessionId: session.id, actionId: action.id, note: "Completed", status: "DONE" })));
    expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(await db.actionReview.count({ where: { actionId: action.id } })).toBe(1);
    expect((await db.action.findUniqueOrThrow({ where: { id: action.id } })).status).toBe("DONE");
  });
  it("stores international discussion text without losing characters", async () => {
    const { source } = await sessions();
    const title = "Améliorer la coopération";
    const action = await capture(source.id, title);
    expect((await actionDetails(data.alice.id, action.id)).title).toBe(title);
  });
});
