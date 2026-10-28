import { beforeAll, afterAll, describe, it, expect } from "vitest";
import pg from "pg";
import {
  createFacilitatedSession, createSession, joinSession, createTopic, changeTopic, changeCollection,
  startVoting, setTopicVote, finalizeVoting, createAction, reviewAction
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

async function prepared(open = true, count = 4) {
  const session = await createFacilitatedSession(data.alice.id, { teamId: data.alpha.id, title: "Voting" });
  const topics = [];
  for (let index = 0; index < count; index++) topics.push(await createTopic(data.alice.id, {
    sessionId: session.id, title: `Topic ${index}`, description: "Preserved"
  }));
  await changeCollection(data.alice.id, { sessionId: session.id, state: "PAUSED", version: 0 });
  if (open) await startVoting(data.alice.id, { sessionId: session.id, version: 1 });
  return { session, topics };
}
async function vote(sessionId: string, topicId: string, version: number, selected = true, actor = data.alice.id) {
  return setTopicVote(actor, { sessionId, topicId, version, selected });
}

describe("VP1/2/3/5: voting lifecycle and ballots", () => {
  it("only starts joined facilitator voting from paused with active topics", async () => {
    const { session, topics } = await prepared(false);
    await joinSession(data.bob.id, { sessionId: session.id });
    await expect(startVoting(data.bob.id, { sessionId: session.id, version: 1 })).rejects.toMatchObject({ kind: "denied" });
    await expect(startVoting(data.alice.id, { sessionId: session.id, version: 0 })).rejects.toMatchObject({ kind: "conflict" });
    await changeCollection(data.alice.id, { sessionId: session.id, state: "COLLECTING", version: 1 });
    await expect(startVoting(data.alice.id, { sessionId: session.id, version: 2 })).rejects.toMatchObject({ kind: "conflict" });
    await changeCollection(data.alice.id, { sessionId: session.id, state: "PAUSED", version: 2 });
    await startVoting(data.alice.id, { sessionId: session.id, version: "3" });
    await expect(startVoting(data.alice.id, { sessionId: session.id, version: 4 })).rejects.toMatchObject({ kind: "conflict" });
    expect(await db.teamSession.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({
      votingState: "OPEN", votingStartedAt: expect.any(Date), votingFinalizedAt: null, lifecycleVersion: 4
    });
    expect((await sessionSnapshot(data.alice.id, session.id)).voting.agenda).toHaveLength(topics.length);
    const empty = await prepared(false, 0);
    await expect(startVoting(data.alice.id, { sessionId: empty.session.id, version: 1 })).rejects.toMatchObject({ kind: "validation" });
    expect((await db.teamSession.findUniqueOrThrow({ where: { id: empty.session.id } })).votingState).toBe("NOT_STARTED");
  });

  it("requires joining, grants a late joiner the same budget, and never resets an existing ballot", async () => {
    const { session, topics } = await prepared();
    await expect(vote(session.id, topics[0].id, 0, true, data.bob.id)).rejects.toMatchObject({ kind: "denied" });
    expect((await sessionSnapshot(data.bob.id, session.id)).voting).toMatchObject({
      ballotVersion: null, remaining: null, selectedTopicIds: [], canVote: false
    });
    await joinSession(data.bob.id, { sessionId: session.id });
    await vote(session.id, topics[0].id, 0, true, data.bob.id);
    await joinSession(data.bob.id, { sessionId: session.id });
    expect((await sessionSnapshot(data.bob.id, session.id)).voting).toMatchObject({
      ballotVersion: 1, remaining: 2, selectedTopicIds: [topics[0].id]
    });
  });

  it("caps at three distinct votes, supports unselect/refund and makes same-version no-ops harmless", async () => {
    const { session, topics } = await prepared();
    await vote(session.id, topics[0].id, 0, false);
    expect((await sessionSnapshot(data.alice.id, session.id)).voting.ballotVersion).toBe(0);
    for (let i = 0; i < 3; i++) await vote(session.id, topics[i].id, i);
    await expect(vote(session.id, topics[3].id, 3)).rejects.toThrow(/three|3/);
    await vote(session.id, topics[0].id, 3);
    expect(await db.topicVote.count({ where: { sessionId: session.id } })).toBe(3);
    await expect(vote(session.id, topics[0].id, 0)).rejects.toMatchObject({ kind: "conflict" });
    await vote(session.id, topics[0].id, 3, false);
    await vote(session.id, topics[3].id, 4);
    await expect(vote(session.id, topics[3].id, 4, false)).rejects.toMatchObject({ kind: "conflict" });
    expect((await sessionSnapshot(data.alice.id, session.id)).voting).toMatchObject({
      remaining: 0, ballotVersion: 5, selectedTopicIds: expect.arrayContaining([topics[1].id, topics[2].id, topics[3].id])
    });
  });

  it("rejects foreign/missing/removed topics and ignores forged author/team/count", async () => {
    const { session, topics } = await prepared();
    const other = await prepared();
    const removed = await db.topic.create({ data: {
      teamId: data.alpha.id, sessionId: session.id, authorId: data.alice.id,
      title: "Removed", removedAt: new Date(), removedById: data.alice.id
    } });
    for (const topicId of [other.topics[0].id, "missing", removed.id]) {
      await expect(vote(session.id, topicId, 0)).rejects.toMatchObject({ kind: "denied" });
    }
    await setTopicVote(data.alice.id, {
      sessionId: session.id, topicId: topics[0].id, selected: true, version: 0,
      userId: data.bob.id, teamId: data.beta.id, count: 100, ballotVersion: 100
    });
    expect(await db.topicVote.findMany({ where: { sessionId: session.id } })).toEqual([
      expect.objectContaining({ userId: data.alice.id, teamId: data.alpha.id, topicId: topics[0].id })
    ]);
  });

  it("denies anonymous and foreign-team access without exposing a session or ballot", async () => {
    const foreign = await createFacilitatedSession(data.bob.id, { teamId: data.beta.id, title: "Foreign voting" });
    const topic = await createTopic(data.bob.id, { sessionId: foreign.id, title: "Foreign", description: "" });
    await changeCollection(data.bob.id, { sessionId: foreign.id, state: "PAUSED", version: 0 });
    await startVoting(data.bob.id, { sessionId: foreign.id, version: 1 });
    for (const actor of ["", data.alice.id]) {
      await expect(sessionSnapshot(actor, foreign.id)).rejects.toMatchObject({ kind: "denied" });
      await expect(vote(foreign.id, topic.id, 0, true, actor)).rejects.toMatchObject({ kind: "denied" });
      await expect(finalizeVoting(actor, { sessionId: foreign.id, version: 2 })).rejects.toMatchObject({ kind: "denied" });
      await expect(startVoting(actor, { sessionId: foreign.id, version: 2 })).rejects.toMatchObject({ kind: "denied" });
    }
    expect(await db.topicVote.count({ where: { sessionId: foreign.id } })).toBe(0);
  });

  it("rejects legacy and closed commands without inventing voting history", async () => {
    const legacy = await createSession(data.alice.id, { teamId: data.alpha.id, title: "Legacy" });
    const { session, topics } = await prepared(false);
    await changeCollection(data.alice.id, { sessionId: session.id, state: "CLOSED", version: 1 });
    for (const id of [legacy.id, session.id]) {
      for (const operation of [startVoting, finalizeVoting]) {
        await expect(operation(data.alice.id, { sessionId: id, version: 0 })).rejects.toMatchObject({ kind: "conflict" });
      }
      await expect(vote(id, topics[0].id, 0)).rejects.toMatchObject({ kind: "conflict" });
      expect(await db.topicVote.count({ where: { sessionId: id } })).toBe(0);
    }
  });

  it("blocks topic/resume/close in Open and freezes ballots/agenda after Finalized", async () => {
    const { session, topics } = await prepared();
    for (const state of ["COLLECTING", "CLOSED"]) {
      await expect(changeCollection(data.alice.id, { sessionId: session.id, version: 2, state })).rejects.toMatchObject({ kind: "conflict" });
    }
    await expect(createTopic(data.alice.id, { sessionId: session.id, title: "Blocked", description: "" })).rejects.toMatchObject({ kind: "conflict" });
    for (const remove of [false, true]) {
      await expect(changeTopic(data.alice.id, {
        sessionId: session.id, topicId: topics[0].id, version: 0, title: "Blocked", description: ""
      }, remove)).rejects.toMatchObject({ kind: "conflict" });
    }
    await joinSession(data.bob.id, { sessionId: session.id });
    await expect(finalizeVoting(data.bob.id, { sessionId: session.id, version: 2 })).rejects.toMatchObject({ kind: "denied" });
    await finalizeVoting(data.alice.id, { sessionId: session.id, version: 2 });
    const final = (await sessionSnapshot(data.alice.id, session.id)).voting.agenda;
    await expect(vote(session.id, topics[0].id, 0)).rejects.toMatchObject({ kind: "conflict" });
    for (const operation of [startVoting, finalizeVoting]) {
      await expect(operation(data.alice.id, { sessionId: session.id, version: 3 })).rejects.toMatchObject({ kind: "conflict" });
    }
    await expect(changeCollection(data.alice.id, { sessionId: session.id, version: 3, state: "COLLECTING" })).rejects.toMatchObject({ kind: "conflict" });
    await changeCollection(data.alice.id, { sessionId: session.id, version: 3, state: "CLOSED" });
    expect((await sessionSnapshot(data.alice.id, session.id)).voting.agenda).toEqual(final);
  });

  it.each([null, false, "", [], -1, 0.1])("rejects malformed command revision %j without effects", async version => {
    const { session, topics } = await prepared();
    await expect(setTopicVote(data.alice.id, { sessionId: session.id, topicId: topics[0].id, selected: true, version })).rejects.toMatchObject({ kind: "validation" });
    await expect(finalizeVoting(data.alice.id, { sessionId: session.id, version })).rejects.toMatchObject({ kind: "validation" });
    expect(await db.topicVote.count({ where: { sessionId: session.id } })).toBe(0);
    expect((await db.teamSession.findUniqueOrThrow({ where: { id: session.id } })).votingState).toBe("OPEN");
  });

  it("reports oversized stale revisions and exhausted versions explicitly rather than database overflow", async () => {
    const { session, topics } = await prepared();
    for (const version of [2147483648, Number.MAX_SAFE_INTEGER]) {
      await expect(vote(session.id, topics[0].id, version)).rejects.toMatchObject({ kind: "conflict" });
      await expect(finalizeVoting(data.alice.id, { sessionId: session.id, version })).rejects.toMatchObject({ kind: "conflict" });
    }
    await db.sessionParticipant.update({ where: { sessionId_userId: { sessionId: session.id, userId: data.alice.id } }, data: { ballotVersion: 2147483647 } });
    await expect(vote(session.id, topics[0].id, 2147483647)).rejects.toMatchObject({ kind: "conflict" });
    await db.teamSession.update({ where: { id: session.id }, data: { lifecycleVersion: 2147483647 } });
    await expect(finalizeVoting(data.alice.id, { sessionId: session.id, version: 2147483647 })).rejects.toMatchObject({ kind: "conflict" });
    expect(await db.agendaEntry.count({ where: { sessionId: session.id } })).toBe(0);
  });
});

describe("VP6/7/12: results, privacy and history", () => {
  it("persists complete deterministic ranks including ties, duplicate titles and zero votes", async () => {
    const { session, topics } = await prepared();
    const at = new Date("2026-01-01");
    await db.topic.updateMany({ where: { sessionId: session.id }, data: { title: "Same", createdAt: at } });
    await joinSession(data.bob.id, { sessionId: session.id });
    await vote(session.id, topics[2].id, 0);
    await vote(session.id, topics[2].id, 0, true, data.bob.id);
    await vote(session.id, topics[0].id, 1, true, data.bob.id);
    const a = await sessionSnapshot(data.alice.id, session.id);
    const b = await sessionSnapshot(data.bob.id, session.id);
    expect(a.voting.selectedTopicIds).toEqual([topics[2].id]);
    expect(b.voting.selectedTopicIds.sort()).toEqual([topics[0].id, topics[2].id].sort());
    expect(a.voting.agenda).toEqual([
      { topicId: topics[2].id, position: 1, count: 2 },
      { topicId: topics[0].id, position: 2, count: 1 },
      ...[topics[1].id, topics[3].id].sort().map((topicId, i) => ({ topicId, position: i + 3, count: 0 }))
    ]);
    expect(JSON.stringify(a)).not.toMatch(/"userId"|"votes"|"access_token"|"sessionToken"/);
    expect(a.participants[1]).not.toHaveProperty("ballotVersion");
    await finalizeVoting(data.alice.id, { sessionId: session.id, version: 2 });
    expect((await sessionSnapshot(data.alice.id, session.id)).voting.agenda).toEqual(a.voting.agenda);
    expect(await db.agendaEntry.count({ where: { sessionId: session.id } })).toBe(4);
  });

  it("retains revoked contributions; restored membership resumes the original ballot", async () => {
    const { session, topics } = await prepared();
    await joinSession(data.bob.id, { sessionId: session.id });
    await vote(session.id, topics[0].id, 0, true, data.bob.id);
    await db.membership.delete({ where: { teamId_userId: { teamId: data.alpha.id, userId: data.bob.id } } });
    try {
      await expect(sessionSnapshot(data.bob.id, session.id)).rejects.toMatchObject({ kind: "denied" });
      await expect(vote(session.id, topics[1].id, 1, true, data.bob.id)).rejects.toMatchObject({ kind: "denied" });
      expect((await sessionSnapshot(data.alice.id, session.id)).voting.agenda[0].count).toBe(1);
    } finally { await db.membership.create({ data: { teamId: data.alpha.id, userId: data.bob.id } }); }
    await joinSession(data.bob.id, { sessionId: session.id });
    expect((await sessionSnapshot(data.bob.id, session.id)).voting).toMatchObject({ ballotVersion: 1, remaining: 2 });
    await finalizeVoting(data.alice.id, { sessionId: session.id, version: 2 });
    expect((await sessionSnapshot(data.bob.id, session.id)).voting.agenda[0].count).toBe(1);
  });

  it("allows joining after finalization without changing its stored zero-vote agenda", async () => {
    const { session } = await prepared();
    await finalizeVoting(data.alice.id, { sessionId: session.id, version: 2 });
    const final = (await sessionSnapshot(data.alice.id, session.id)).voting.agenda;
    await joinSession(data.bob.id, { sessionId: session.id });
    const snapshot = await sessionSnapshot(data.bob.id, session.id);
    expect(snapshot.voting).toMatchObject({ ballotVersion: 0, remaining: 3, canVote: false, agenda: final });
    expect(final.every(item => item.count === 0)).toBe(true);
    await expect(vote(session.id, final[0].topicId, 0, true, data.bob.id)).rejects.toMatchObject({ kind: "conflict" });
  });

  it("allows action capture/review through Open/Finalized and later follow-up after closure", async () => {
    const source = await createSession(data.alice.id, { teamId: data.alpha.id, title: "Earlier" });
    await db.teamSession.update({ where: { id: source.id }, data: { createdAt: new Date("2025-01-01") } });
    const first = await createAction(data.alice.id, { sessionId: source.id, title: "First", context: "", ownerId: data.alice.id, dueDate: "" });
    const { session } = await prepared();
    await reviewAction(data.alice.id, { sessionId: session.id, actionId: first.id, note: "Open review", status: "IN_PROGRESS" });
    await finalizeVoting(data.alice.id, { sessionId: session.id, version: 2 });
    const action = await createAction(data.alice.id, { sessionId: session.id, title: "Finalized capture", context: "Keep", ownerId: data.alice.id, dueDate: "" });
    await changeCollection(data.alice.id, { sessionId: session.id, state: "CLOSED", version: 3 });
    await expect(createAction(data.alice.id, { sessionId: session.id, title: "Closed", context: "", ownerId: data.alice.id, dueDate: "" })).rejects.toMatchObject({ kind: "conflict" });
    const later = await createSession(data.alice.id, { teamId: data.alpha.id, title: "Later" });
    await db.teamSession.update({ where: { id: later.id }, data: { createdAt: new Date("2099-01-01") } });
    await reviewAction(data.alice.id, { sessionId: later.id, actionId: action.id, note: "Done later", status: "DONE" });
    expect((await db.action.findUniqueOrThrow({ where: { id: action.id } })).status).toBe("DONE");
  });

  it("rolls back finalization on agenda persistence failure", async () => {
    const { session, topics } = await prepared();
    await db.agendaEntry.create({ data: { teamId: data.alpha.id, sessionId: session.id, topicId: topics[3].id, position: 4, discussionPosition: 4, voteCount: 0 } });
    await expect(finalizeVoting(data.alice.id, { sessionId: session.id, version: 2 })).rejects.toThrow();
    expect((await db.teamSession.findUniqueOrThrow({ where: { id: session.id } })).votingState).toBe("OPEN");
    expect(await db.agendaEntry.count({ where: { sessionId: session.id } })).toBe(1);
    await db.agendaEntry.deleteMany({ where: { sessionId: session.id } });
    await finalizeVoting(data.alice.id, { sessionId: session.id, version: 2 });
    expect(await db.agendaEntry.count({ where: { sessionId: session.id } })).toBe(4);
  });

  it("rolls back every inserted rank when the final state write fails after a complete agenda", async () => {
    const { session, topics } = await prepared();
    await vote(session.id, topics[0].id, 0);
    await db.$executeRawUnsafe(`CREATE FUNCTION teampulse_test_reject_finalization() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."id" = TG_ARGV[0] AND NEW."votingState" = 'FINALIZED' THEN
          IF (SELECT count(*) FROM "AgendaEntry" WHERE "sessionId" = NEW."id") <> 4 THEN
            RAISE EXCEPTION 'Agenda was not complete before the state update';
          END IF;
          RAISE EXCEPTION 'Injected finalization failure after complete agenda';
        END IF;
        RETURN NEW;
      END;
    $$`);
    try {
      await db.$executeRawUnsafe(`CREATE TRIGGER teampulse_test_reject_finalization BEFORE UPDATE ON "TeamSession"
        FOR EACH ROW EXECUTE FUNCTION teampulse_test_reject_finalization('${session.id}')`);
      await expect(finalizeVoting(data.alice.id, { sessionId: session.id, version: 2 }))
        .rejects.toThrow(/Injected finalization failure after complete agenda/);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS teampulse_test_reject_finalization ON "TeamSession"`);
      await db.$executeRawUnsafe(`DROP FUNCTION teampulse_test_reject_finalization()`);
    }
    expect(await db.agendaEntry.count({ where: { sessionId: session.id } })).toBe(0);
    expect(await db.teamSession.findUniqueOrThrow({ where: { id: session.id } }))
      .toMatchObject({ votingState: "OPEN", votingFinalizedAt: null, lifecycleVersion: 2 });
    expect(await db.topicVote.count({ where: { sessionId: session.id } })).toBe(1);
    await finalizeVoting(data.alice.id, { sessionId: session.id, version: 2 });
    expect(await db.agendaEntry.count({ where: { sessionId: session.id } })).toBe(4);
  });
});

describe("VP4: serialized PostgreSQL races", () => {
  async function blocked(sessionId: string, operations: (() => Promise<unknown>)[], commit?: (client: pg.Client) => Promise<unknown>) {
    return queuedSession(db, sessionId, operations, commit);
  }
  it("serializes the last ballot slot and preserves simultaneous distinct-voter contributions", async () => {
    const { session, topics } = await prepared();
    await vote(session.id, topics[0].id, 0);
    await vote(session.id, topics[1].id, 1);
    const result = await blocked(session.id, [() => vote(session.id, topics[2].id, 2), () => vote(session.id, topics[3].id, 2)]);
    expect(result.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(result.filter(item => item.status === "rejected")).toHaveLength(1);
    expect(await db.topicVote.count({ where: { sessionId: session.id } })).toBe(3);
    await joinSession(data.bob.id, { sessionId: session.id });
    const separate = await blocked(session.id, [
      () => vote(session.id, topics[0].id, 3, false),
      () => vote(session.id, topics[0].id, 0, true, data.bob.id)
    ]);
    expect(separate.every(item => item.status === "fulfilled")).toBe(true);
    expect(await db.topicVote.count({ where: { sessionId: session.id } })).toBe(3);
  });

  it("includes a preceding vote or rejects it when finalization commits first", async () => {
    const { session, topics } = await prepared();
    const results = await blocked(session.id, [
      () => vote(session.id, topics[0].id, 0),
      () => finalizeVoting(data.alice.id, { sessionId: session.id, version: 2 })
    ]);
    expect(results[1].status).toBe("fulfilled");
    const count = await db.topicVote.count({ where: { sessionId: session.id } });
    expect(count).toBe(results[0].status === "fulfilled" ? 1 : 0);
    expect((await sessionSnapshot(data.alice.id, session.id)).voting.agenda.reduce((sum, item) => sum + item.count, 0)).toBe(count);
  });

  it("rechecks voting freeze after a blocked stale topic edit and lifecycle request", async () => {
    const { session, topics } = await prepared(false);
    const results = await blocked(session.id, [
      () => changeTopic(data.alice.id, { sessionId: session.id, topicId: topics[0].id, version: 0, title: "Late", description: "" }),
      () => changeCollection(data.alice.id, { sessionId: session.id, state: "COLLECTING", version: 1 }),
      () => changeCollection(data.alice.id, { sessionId: session.id, state: "CLOSED", version: 1 })
    ], client => client.query(`UPDATE "TeamSession" SET "votingState"='OPEN',"votingStartedAt"=CURRENT_TIMESTAMP,"lifecycleVersion"=2 WHERE "id"=$1`, [session.id]));
    expect(results.every(item => item.status === "rejected")).toBe(true);
    expect((await db.topic.findUniqueOrThrow({ where: { id: topics[0].id } })).title).toBe("Topic 0");
    expect((await db.teamSession.findUniqueOrThrow({ where: { id: session.id } })).votingState).toBe("OPEN");
  });

  it("denies a queued vote when membership revocation commits first", async () => {
    const { session, topics } = await prepared();
    await joinSession(data.bob.id, { sessionId: session.id });
    try {
      const results = await blocked(session.id, [() => vote(session.id, topics[0].id, 0, true, data.bob.id)],
        client => client.query(`DELETE FROM "Membership" WHERE "teamId"=$1 AND "userId"=$2`, [data.alpha.id, data.bob.id]));
      expect(results).toEqual([{ status: "rejected", reason: expect.objectContaining({ kind: "denied" }) }]);
      expect(await db.topicVote.count({ where: { sessionId: session.id } })).toBe(0);
      expect((await db.sessionParticipant.findUniqueOrThrow({
        where: { sessionId_userId: { sessionId: session.id, userId: data.bob.id } }
      })).ballotVersion).toBe(0);
    } finally {
      await db.membership.upsert({
        where: { teamId_userId: { teamId: data.alpha.id, userId: data.bob.id } },
        create: { teamId: data.alpha.id, userId: data.bob.id }, update: {}
      });
    }
  });
});
