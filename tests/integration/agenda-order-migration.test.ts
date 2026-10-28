import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { expect, it } from "vitest";
import { testDatabase } from "../support/database";

it("MO8: migration preserves every old column, attempts and parking events; exact backfill, narrow deferral and scoped history", async () => {
  const guard = testDatabase();
  await guard.$disconnect();
  const url = new URL(process.env.TEST_DATABASE_URL!);
  const name = `order_migration_${randomUUID().replaceAll("-", "")}_test`;
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
    for (const migration of ["20261026120000_initial", "20261027100000_facilitated_topics", "20261028090000_topic_voting", "20261028100000_timed_topic_discussion", "20261028110000_parking_lot"]) {
      await target.query(await readFile(join("prisma", "migrations", migration, "migration.sql"), "utf8"));
    }
    await target.query(`
      INSERT INTO "User" ("id","name") VALUES ('member','Synthetic member');
      INSERT INTO "Account" ("id","userId","type","provider","providerAccountId") VALUES ('account','member','oauth','github','synthetic');
      INSERT INTO "Session" ("id","userId","sessionToken","expires") VALUES ('auth','member','synthetic','2099-01-01');
      INSERT INTO "VerificationToken" ("identifier","token","expires") VALUES ('synthetic','verification','2099-01-01');
      INSERT INTO "Team" ("id","name") VALUES ('team','Synthetic team'),('foreign','Other');
      INSERT INTO "Membership" ("teamId","userId") VALUES ('team','member');
      INSERT INTO "TeamSession" ("id","teamId","title") VALUES ('legacy','team','Legacy'),('later','team','Later');
      INSERT INTO "Action" ("id","teamId","sourceSessionId","ownerId","title","context","updatedAt","status")
        VALUES ('action','team','legacy','member','Keep action','Keep context',CURRENT_TIMESTAMP,'IN_PROGRESS');
      INSERT INTO "ActionReview" ("id","teamId","actionId","reviewSessionId","actorId","note","resultingStatus")
        VALUES ('review','team','action','later','member','Keep note','IN_PROGRESS');
      INSERT INTO "TeamSession" ("id","teamId","title","kind","facilitatorId","collectionState","lifecycleVersion","votingState","votingStartedAt","votingFinalizedAt")
        VALUES ('ordered','team','Ordered','FACILITATED','member','PAUSED',14,'FINALIZED','2026-01-01','2026-01-02');
      INSERT INTO "SessionParticipant" ("teamId","sessionId","userId","ballotVersion") VALUES ('team','ordered','member',1);
    `);
    for (let i = 1; i <= 5; i++) {
      await target.query(`INSERT INTO "Topic" ("id","teamId","sessionId","authorId","title","description","updatedAt")
        VALUES ($1,'team','ordered','member',$1,'Keep context',CURRENT_TIMESTAMP)`, [`topic${i}`]);
      await target.query(`INSERT INTO "AgendaEntry" ("teamId","sessionId","topicId","position","voteCount")
        VALUES ('team','ordered',$1,$2,$2)`, [`topic${i}`, i]);
    }
    await target.query(`
      INSERT INTO "TopicVote" ("teamId","sessionId","userId","topicId") VALUES ('team','ordered','member','topic1');
      INSERT INTO "TopicDiscussion" ("teamId","sessionId","topicId","attemptNumber","state","remainingMs","allocatedMs","startedAt","finishedAt","startedById","finishedById","outcome")
        VALUES ('team','ordered','topic1',1,'FINISHED',0,300000,'2026-01-02','2026-01-03','member','member','DISCUSSED'),
          ('team','ordered','topic3',1,'FINISHED',200001,300000,'2026-01-02','2026-01-03','member','member','DEFERRED'),
          ('team','ordered','topic3',2,'FINISHED',100001,300000,'2026-01-04','2026-01-05','member','member','DEFERRED');
      INSERT INTO "TopicDiscussion" ("teamId","sessionId","topicId","state","deadlineAt","allocatedMs","startedAt","startedById")
        VALUES ('team','ordered','topic2','RUNNING','2099-01-01',300000,'2026-01-02','member');
      INSERT INTO "TopicParkingEvent" ("teamId","sessionId","topicId","version","kind","reason","createdAt","actorId","attemptNumber")
        VALUES ('team','ordered','topic3',4,'PARK','First reason','2026-01-03','member',1),
          ('team','ordered','topic3',5,'RESTORE','','2026-01-04','member',NULL),
          ('team','ordered','topic3',7,'PARK','Second reason','2026-01-05','member',2),
          ('team','ordered','topic3',8,'RESTORE','','2026-01-06','member',NULL),
          ('team','ordered','topic4',11,'PARK','Waiting reason','2026-01-07','member',NULL);
    `);
    const metadata = await target.query<{ table_name: string; column_name: string }>(
      `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`);
    const columns = new Map<string, string[]>();
    for (const row of metadata.rows) columns.set(row.table_name, [...(columns.get(row.table_name) ?? []), row.column_name]);
    const select = (table: string, names: string[]) => `SELECT ${names.map(name => `"${name}"`).join(",")} FROM "${table}" ORDER BY ${names.map(name => `"${name}"`).join(",")}`;
    const before = new Map<string, unknown>();
    for (const [table, names] of columns) before.set(table, (await target.query(select(table, names))).rows);
    const migration = await readFile(join("prisma", "migrations", "20261028120000_manual_agenda_order", "migration.sql"), "utf8");
    await target.query(`CREATE TABLE "AgendaOrderChange" ("collision" INTEGER)`);
    await expect(target.query(migration)).rejects.toThrow(/already exists/);
    await target.query("ROLLBACK");
    expect((await target.query(`SELECT column_name FROM information_schema.columns WHERE table_name='AgendaEntry' AND column_name='discussionPosition'`)).rowCount).toBe(0);
    await target.query(`DROP TABLE "AgendaOrderChange"`);
    await target.query(migration);
    for (const [table, names] of columns) expect((await target.query(select(table, names))).rows).toEqual(before.get(table));
    expect((await target.query(`SELECT "discussionPosition"="position" AS identical FROM "AgendaEntry"`)).rows).toEqual(Array(5).fill({ identical: true }));
    expect((await target.query(`SELECT * FROM "AgendaOrderChange"`)).rowCount).toBe(0);
    expect((await target.query(`SELECT contype,condeferrable,condeferred FROM pg_constraint WHERE conrelid='"AgendaEntry"'::regclass
      AND conname='AgendaEntry_sessionId_discussionPosition_key'`)).rows).toEqual([{ contype: "u", condeferrable: true, condeferred: false }]);
    await expect(target.query(`UPDATE "AgendaEntry" SET "discussionPosition"=0 WHERE "topicId"='topic1'`)).rejects.toThrow(/check/);
    await expect(target.query(`UPDATE "AgendaEntry" SET "discussionPosition"=2 WHERE "topicId"='topic1'`)).rejects.toThrow(/unique/);
    await target.query(`BEGIN; SET CONSTRAINTS "AgendaEntry_sessionId_discussionPosition_key" DEFERRED;
      UPDATE "AgendaEntry" SET "discussionPosition"=CASE WHEN "topicId"='topic3' THEN 5 ELSE 3 END
      WHERE "sessionId"='ordered' AND "topicId" IN ('topic3','topic5'); COMMIT;`);
    const plan = `SELECT "discussionPosition" FROM "AgendaEntry" ORDER BY "position"`;
    expect((await target.query(plan)).rows.map(row => row.discussionPosition)).toEqual([1, 2, 5, 4, 3]);
    const event = `INSERT INTO "AgendaOrderChange" ("teamId","sessionId","version","actorId","createdAt","topicId","neighborTopicId","direction","beforeQueue","afterQueue")
      VALUES ($1,'ordered',$2,$3,'2026-01-08',$4,$5,'EARLIER',$6::jsonb,$7::jsonb)`;
    for (const values of [
      ["foreign", 15, "member", "topic5", "topic4", '["topic3","topic4","topic5"]', '["topic3","topic5","topic4"]'],
      ["team", 15, "missing", "topic5", "topic4", '["topic3","topic4","topic5"]', '["topic3","topic5","topic4"]'],
      ["team", 15, "member", "topic5", "topic5", '["topic3","topic4","topic5"]', '["topic3","topic5","topic4"]'],
      ["team", 0, "member", "topic5", "topic4", '["topic3","topic4","topic5"]', '["topic3","topic5","topic4"]'],
      ["team", 15, "member", "topic5", "topic4", '{}', '["topic5","topic4"]'],
      ["team", 15, "member", "topic5", "topic4", '["topic4"]', '["topic5"]'],
      ["team", 15, "member", "topic5", "topic4", '["topic4","topic5"]', '["topic5","topic4","topic3"]']
    ]) await expect(target.query(event, values)).rejects.toThrow();
    await target.query("BEGIN");
    await target.query(`SET CONSTRAINTS "AgendaEntry_sessionId_discussionPosition_key" DEFERRED`);
    await target.query(`UPDATE "AgendaEntry" SET "discussionPosition"=3 WHERE "topicId"='topic4'`);
    await target.query(event, ["team", 15, "member", "topic5", "topic4", '["topic3","topic4","topic5"]', '["topic3","topic5","topic4"]']);
    await target.query(`UPDATE "TeamSession" SET "lifecycleVersion"=15 WHERE id='ordered'`);
    await expect(target.query("COMMIT")).rejects.toThrow(/unique/);
    expect((await target.query(plan)).rows.map(row => row.discussionPosition)).toEqual([1, 2, 5, 4, 3]);
    expect((await target.query(`SELECT * FROM "AgendaOrderChange"`)).rowCount).toBe(0);
    expect((await target.query(`SELECT "lifecycleVersion" FROM "TeamSession" WHERE id='ordered'`)).rows[0].lifecycleVersion).toBe(14);
  } finally {
    await target?.end();
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
