import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { expect, it } from "vitest";
import { testDatabase } from "../support/database";

it("MS7: additive migration preserves every old column and history; empty reports, exact constraints and failed DDL rollback", async () => {
  const guard = testDatabase();
  await guard.$disconnect();
  const url = new URL(process.env.TEST_DATABASE_URL!);
  const name = `summary_migration_${randomUUID().replaceAll("-", "")}_test`;
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
      "20261028100000_timed_topic_discussion", "20261028110000_parking_lot", "20261028120000_manual_agenda_order"]) {
      await target.query(await readFile(join("prisma", "migrations", migration, "migration.sql"), "utf8"));
    }
    await target.query(`
      INSERT INTO "User" ("id","name") VALUES ('member','Synthetic member'),('generator','Retained attribution');
      INSERT INTO "Account" ("id","userId","type","provider","providerAccountId") VALUES ('account','member','oauth','github','synthetic');
      INSERT INTO "Session" ("id","userId","sessionToken","expires") VALUES ('auth','member','synthetic','2099-01-01');
      INSERT INTO "VerificationToken" ("identifier","token","expires") VALUES ('synthetic','verification','2099-01-01');
      INSERT INTO "Team" ("id","name") VALUES ('team','Synthetic team'),('foreign','Other');
      INSERT INTO "Membership" ("teamId","userId") VALUES ('team','member');
      INSERT INTO "TeamSession" ("id","teamId","title") VALUES ('legacy','team','Legacy'),('later','team','Later');
      INSERT INTO "Action" ("id","teamId","sourceSessionId","ownerId","title","context","updatedAt","status")
        VALUES ('action','team','legacy','member','Keep action','Keep context',CURRENT_TIMESTAMP,'DONE');
      INSERT INTO "ActionReview" ("id","teamId","actionId","reviewSessionId","actorId","note","resultingStatus")
        VALUES ('review','team','action','later','member','Keep note','DONE');
      INSERT INTO "TeamSession" ("id","teamId","title","kind","facilitatorId","collectionState","closedAt","lifecycleVersion","votingState","votingStartedAt","votingFinalizedAt")
        VALUES ('closed','team','Closed','FACILITATED','member','CLOSED','2026-01-05',8,'FINALIZED','2026-01-01','2026-01-02');
      INSERT INTO "SessionParticipant" ("teamId","sessionId","userId","ballotVersion") VALUES ('team','closed','member',1);
      INSERT INTO "Topic" ("id","teamId","sessionId","authorId","title","description","updatedAt")
        VALUES ('topic1','team','closed','member','First','Keep context',CURRENT_TIMESTAMP),
          ('topic2','team','closed','member','Second','Keep more context',CURRENT_TIMESTAMP);
      INSERT INTO "AgendaEntry" ("teamId","sessionId","topicId","position","discussionPosition","voteCount")
        VALUES ('team','closed','topic1',1,2,1),('team','closed','topic2',2,1,0);
      INSERT INTO "TopicVote" ("teamId","sessionId","userId","topicId") VALUES ('team','closed','member','topic1');
      INSERT INTO "TopicDiscussion" ("teamId","sessionId","topicId","attemptNumber","state","remainingMs","allocatedMs","startedAt","finishedAt","startedById","finishedById","outcome")
        VALUES ('team','closed','topic2',1,'FINISHED',200001,300000,'2026-01-02','2026-01-03','member','member','DEFERRED');
      INSERT INTO "TopicParkingEvent" ("teamId","sessionId","topicId","version","kind","reason","createdAt","actorId","attemptNumber")
        VALUES ('team','closed','topic2',5,'PARK','Keep reason','2026-01-03','member',1),
          ('team','closed','topic2',6,'RESTORE','','2026-01-04','member',NULL);
      INSERT INTO "AgendaOrderChange" ("teamId","sessionId","version","actorId","createdAt","topicId","neighborTopicId","direction","beforeQueue","afterQueue")
        VALUES ('team','closed',4,'member','2026-01-02','topic2','topic1','EARLIER','["topic1","topic2"]','["topic2","topic1"]');
    `);
    const metadata = await target.query<{ table_name: string; column_name: string }>(
      `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`);
    const columns = new Map<string, string[]>();
    for (const row of metadata.rows) columns.set(row.table_name, [...(columns.get(row.table_name) ?? []), row.column_name]);
    const select = (table: string, names: string[]) =>
      `SELECT ${names.map(column => `"${column}"`).join(",")} FROM "${table}" ORDER BY ${names.map(column => `"${column}"`).join(",")}`;
    const before = new Map<string, unknown>();
    for (const [table, names] of columns) {
      const rows = (await target.query(select(table, names))).rows;
      expect(rows.length).toBeGreaterThan(0);
      before.set(table, rows);
    }
    const migration = await readFile(join("prisma", "migrations", "20261028130000_meeting_summary", "migration.sql"), "utf8");
    const failing = migration.replace("COMMIT;", 'SELECT * FROM "injected_missing_summary_relation"; COMMIT;');
    await expect(target.query(failing)).rejects.toThrow(/does not exist/);
    await target.query("ROLLBACK");
    expect((await target.query(`SELECT to_regclass('"SessionSummary"') AS report`)).rows).toEqual([{ report: null }]);
    await target.query(migration);
    for (const [table, names] of columns) expect((await target.query(select(table, names))).rows).toEqual(before.get(table));
    expect((await target.query(`SELECT * FROM "SessionSummary"`)).rowCount).toBe(0);
    expect((await target.query(`SELECT condeferrable,condeferred FROM pg_constraint WHERE conrelid='"AgendaEntry"'::regclass
      AND conname='AgendaEntry_sessionId_discussionPosition_key'`)).rows).toEqual([{ condeferrable: true, condeferred: false }]);
    const insert = `INSERT INTO "SessionSummary" ("teamId","sessionId","generatedById","generatedByName","generatedAt","formatVersion","note","content")
      VALUES ($1,'closed',$2,'Captured name','2026-01-05',$3,$4,$5::jsonb)`;
    for (const values of [
      ["foreign", "generator", 1, "", "{}"], ["team", "missing", 1, "", "{}"],
      ["team", "generator", 0, "", "{}"], ["team", "generator", 1, "x".repeat(4001), "{}"],
      ["team", "generator", 1, " untrimmed ", "{}"], ["team", "generator", 1, "", "[]"],
      ["team", "generator", 1, "", "null"]
    ]) await expect(target.query(insert, values)).rejects.toThrow();
    await target.query(insert, ["team", "generator", 1, "x".repeat(4000), "{}"]);
    await expect(target.query(insert, ["team", "generator", 1, "Replacement", "{}"])).rejects.toThrow(/unique/);
    await expect(target.query(`DELETE FROM "User" WHERE id='generator'`)).rejects.toThrow(/foreign key/);
    await expect(target.query(`DELETE FROM "TeamSession" WHERE id='closed'`)).rejects.toThrow(/foreign key/);
    expect((await target.query(`SELECT "note","generatedByName" FROM "SessionSummary"`)).rows)
      .toEqual([{ note: "x".repeat(4000), generatedByName: "Captured name" }]);
  } finally {
    await target?.end();
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
