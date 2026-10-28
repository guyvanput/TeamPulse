import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { expect, it } from "vitest";
import { summaryReportSchema } from "../../src/lib/meeting-summary";
import { testDatabase } from "../support/database";

it("RM8: preserves every original column including a valid saved report; scoped constraints and failed DDL roll back completely", async () => {
  const guard = testDatabase();
  await guard.$disconnect();
  const url = new URL(process.env.TEST_DATABASE_URL!);
  const name = `administration_migration_${randomUUID().replaceAll("-", "")}_test`;
  const admin = new pg.Client({ connectionString: url.href });
  let target: pg.Client | undefined;
  let created = false;
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    url.pathname = `/${name}`;
    target = new pg.Client({ connectionString: url.href });
    await target.connect();
    for (const migration of ["20261026120000_initial", "20261027100000_facilitated_topics", "20261028090000_topic_voting",
      "20261028100000_timed_topic_discussion", "20261028110000_parking_lot", "20261028120000_manual_agenda_order", "20261028130000_meeting_summary"]) {
      await target.query(await readFile(join("prisma", "migrations", migration, "migration.sql"), "utf8"));
    }
    await target.query(`
      INSERT INTO "User" ("id","name") VALUES ('member','Synthetic member'),('other','Other member');
      INSERT INTO "Account" ("id","userId","type","provider","providerAccountId") VALUES ('account','member','oauth','github','synthetic');
      INSERT INTO "Session" ("id","userId","sessionToken","expires") VALUES ('auth','member','synthetic','2099-01-01');
      INSERT INTO "VerificationToken" ("identifier","token","expires") VALUES ('synthetic','verification','2099-01-01');
      INSERT INTO "Team" ("id","name") VALUES ('team','Synthetic team'),('foreign','Other');
      INSERT INTO "Membership" ("teamId","userId") VALUES ('team','member'),('team','other');
      INSERT INTO "TeamSession" ("id","teamId","title") VALUES ('legacy','team','Legacy'),('later','team','Later');
      INSERT INTO "Action" ("id","teamId","sourceSessionId","ownerId","title","context","updatedAt","status")
        VALUES ('action','team','legacy','member','Keep action','Keep context',CURRENT_TIMESTAMP,'DONE');
      INSERT INTO "ActionReview" ("id","teamId","actionId","reviewSessionId","actorId","note","resultingStatus")
        VALUES ('review','team','action','later','member','Keep note','DONE');
      INSERT INTO "TeamSession" ("id","teamId","title","kind","facilitatorId","collectionState","closedAt","lifecycleVersion","votingState","votingStartedAt","votingFinalizedAt")
        VALUES ('closed','team','Closed','FACILITATED','member','CLOSED','2026-01-05',8,'FINALIZED','2026-01-01','2026-01-02');
      INSERT INTO "SessionParticipant" ("teamId","sessionId","userId","ballotVersion") VALUES ('team','closed','member',1),('team','closed','other',2);
      INSERT INTO "Topic" ("id","teamId","sessionId","authorId","title","description","updatedAt")
        VALUES ('topic1','team','closed','member','First','Keep context',CURRENT_TIMESTAMP),('topic2','team','closed','member','Second','Keep more context',CURRENT_TIMESTAMP);
      INSERT INTO "AgendaEntry" ("teamId","sessionId","topicId","position","discussionPosition","voteCount")
        VALUES ('team','closed','topic1',1,2,1),('team','closed','topic2',2,1,0);
      INSERT INTO "TopicVote" ("teamId","sessionId","userId","topicId") VALUES ('team','closed','member','topic1');
      INSERT INTO "TopicDiscussion" ("teamId","sessionId","topicId","attemptNumber","state","remainingMs","allocatedMs","startedAt","finishedAt","startedById","finishedById","outcome")
        VALUES ('team','closed','topic2',1,'FINISHED',200001,300000,'2026-01-02','2026-01-03','member','member','DEFERRED');
      INSERT INTO "TopicParkingEvent" ("teamId","sessionId","topicId","version","kind","reason","createdAt","actorId","attemptNumber")
        VALUES ('team','closed','topic2',5,'PARK','Keep reason','2026-01-03','member',1),('team','closed','topic2',6,'RESTORE','','2026-01-04','member',NULL);
      INSERT INTO "AgendaOrderChange" ("teamId","sessionId","version","actorId","createdAt","topicId","neighborTopicId","direction","beforeQueue","afterQueue")
        VALUES ('team','closed',4,'member','2026-01-02','topic2','topic1','EARLIER','["topic1","topic2"]','["topic2","topic1"]');
    `);
    const report = summaryReportSchema.parse({
      formatVersion: 1, generatedAt: "2026-01-05T00:00:00.000Z", generatedBy: { id: "member", name: "Captured member" }, note: "Keep report",
      content: { session: { id: "closed", title: "Closed", facilitator: { id: "member", name: "Captured member" } },
        participants: [{ id: "member", name: "Captured member", joinedAt: "2026-01-01T00:00:00.000Z" }],
        votingState: "FINALIZED", topics: [
          { id: "topic1", title: "First", description: "Keep context", originalPosition: 1, discussionPosition: 2, voteCount: 1, outcome: "NOT_DISCUSSED", reason: null },
          { id: "topic2", title: "Second", description: "Keep more context", originalPosition: 2, discussionPosition: 1, voteCount: 0, outcome: "NOT_DISCUSSED", reason: null }
        ], actions: [] }
    });
    await target.query(`INSERT INTO "SessionSummary" ("teamId","sessionId","generatedById","generatedByName","generatedAt","formatVersion","note","content")
      VALUES ('team','closed','member',$1,$2,1,$3,$4::jsonb)`, [report.generatedBy.name, report.generatedAt, report.note, JSON.stringify(report.content)]);
    const columns = new Map<string, string[]>();
    for (const row of (await target.query<{ table_name: string; column_name: string }>(
      `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`)).rows) {
      columns.set(row.table_name, [...(columns.get(row.table_name) ?? []), row.column_name]);
    }
    const select = (table: string, names: string[]) =>
      `SELECT ${names.map(column => `"${column}"`).join(",")} FROM "${table}" ORDER BY ${names.map(column => `"${column}"`).join(",")}`;
    const before = new Map<string, unknown>();
    expect(columns.size).toBe(17);
    for (const [table, names] of columns) {
      const rows = (await target.query(select(table, names))).rows;
      expect(rows.length).toBeGreaterThan(0);
      before.set(table, rows);
    }
    const migration = await readFile(join("prisma", "migrations", "20261028140000_session_administration", "migration.sql"), "utf8");
    await expect(target.query(migration.replace("COMMIT;", 'SELECT * FROM "injected_missing_administration_relation"; COMMIT;'))).rejects.toThrow(/does not exist/);
    await target.query("ROLLBACK");
    expect((await target.query(`SELECT to_regclass('"SessionAdministrationEvent"') AS events,to_regtype('"SessionAdministrationKind"') AS kind`)).rows).toEqual([{ events: null, kind: null }]);
    expect((await target.query(`SELECT column_name FROM information_schema.columns WHERE table_name='SessionParticipant' AND column_name='removedAt'`)).rowCount).toBe(0);
    await target.query(migration);
    for (const [table, names] of columns) expect((await target.query(select(table, names))).rows).toEqual(before.get(table));
    expect((await target.query(`SELECT "removedAt" FROM "SessionParticipant"`)).rows).toEqual([{ removedAt: null }, { removedAt: null }]);
    expect((await target.query(`SELECT * FROM "SessionAdministrationEvent"`)).rowCount).toBe(0);
    expect((await target.query(`SELECT condeferrable,condeferred FROM pg_constraint WHERE conrelid='"AgendaEntry"'::regclass
      AND conname='AgendaEntry_sessionId_discussionPosition_key'`)).rows).toEqual([{ condeferrable: true, condeferred: false }]);
    const insert = `INSERT INTO "SessionAdministrationEvent" ("teamId","sessionId","version","kind","actorId","targetId","createdAt","reason")
      VALUES ($1,'closed',$2,$3,$4,$5,'2026-01-05',$6)`;
    for (const values of [
      ["foreign", 9, "TRANSFER", "member", "other", ""], ["team", 9, "TRANSFER", "missing", "other", ""],
      ["team", 9, "TRANSFER", "member", "missing", ""], ["team", 9, "TRANSFER", "member", "member", ""],
      ["team", 0, "TRANSFER", "member", "other", ""], ["team", 9, "UNKNOWN", "member", "other", ""],
      ["team", 9, "TRANSFER", "member", "other", "Not removal"], ["team", 9, "READMIT", "member", "other", "Not removal"],
      ["team", 9, "REMOVE", "member", "other", " untrimmed "], ["team", 9, "REMOVE", "member", "other", "x".repeat(4001)]
    ]) await expect(target.query(insert, values)).rejects.toThrow();
    await target.query(insert, ["team", 9, "REMOVE", "member", "other", "x".repeat(4000)]);
    await expect(target.query(insert, ["team", 9, "TRANSFER", "member", "other", ""])).rejects.toThrow(/unique/);
    await expect(target.query(`DELETE FROM "SessionParticipant" WHERE "sessionId"='closed' AND "userId"='other'`)).rejects.toThrow(/foreign key/);
    await target.query(`DELETE FROM "Membership" WHERE "teamId"='team' AND "userId"='other'`);
    expect((await target.query(`SELECT "targetId","reason" FROM "SessionAdministrationEvent"`)).rows).toEqual([{ targetId: "other", reason: "x".repeat(4000) }]);
  } finally {
    await target?.end();
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
