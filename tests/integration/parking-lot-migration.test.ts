import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import { it, expect } from "vitest";
import { testDatabase } from "../support/database";

it("PL9: transactional parking migration preserves every old column and enforces attempt/event integrity", async () => {
  const guard = testDatabase();
  await guard.$disconnect();
  const url = new URL(process.env.TEST_DATABASE_URL!);
  const name = `parking_migration_${randomUUID().replaceAll("-", "")}_test`;
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
    for (const migration of ["20261026120000_initial", "20261027100000_facilitated_topics", "20261028090000_topic_voting", "20261028100000_timed_topic_discussion"]) {
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
    `);
    for (const state of ["running", "paused", "expired", "finished"]) {
      await target.query(`INSERT INTO "TeamSession" ("id","teamId","title","kind","facilitatorId","collectionState","lifecycleVersion","votingState","votingStartedAt","votingFinalizedAt")
        VALUES ($1,'team',$1,'FACILITATED','member','PAUSED',4,'FINALIZED','2026-01-01','2026-01-02')`, [state]);
      await target.query(`INSERT INTO "SessionParticipant" ("teamId","sessionId","userId","ballotVersion") VALUES ('team',$1,'member',1)`, [state]);
      for (let i = 1; i <= 2; i++) {
        await target.query(`INSERT INTO "Topic" ("id","teamId","sessionId","authorId","title","description","updatedAt","version")
          VALUES ($1,'team',$2,'member',$1,'Keep',CURRENT_TIMESTAMP,2)`, [state + i, state]);
        await target.query(`INSERT INTO "AgendaEntry" ("teamId","sessionId","topicId","position","voteCount") VALUES ('team',$1,$2,$3,1)`, [state, state + i, i]);
      }
      await target.query(`INSERT INTO "TopicVote" ("teamId","sessionId","userId","topicId") VALUES ('team',$1,'member',$2)`, [state, state + "1"]);
      await target.query(`INSERT INTO "TopicDiscussion" ("teamId","sessionId","topicId","state","deadlineAt","remainingMs","allocatedMs","startedAt","finishedAt","startedById","finishedById")
        VALUES ('team',$1,$2,$3,$4,$5,300000,'2026-01-02',$6,'member',$7)`, [
        state, state + "1", state === "paused" ? "PAUSED" : state === "finished" ? "FINISHED" : "RUNNING",
        state === "running" ? "2099-01-01" : state === "expired" ? "2026-01-03" : null,
        state === "paused" ? 200001 : state === "finished" ? 0 : null,
        state === "finished" ? "2026-01-04" : null, state === "finished" ? "member" : null
      ]);
    }
    const metadata = await target.query<{ table_name: string; column_name: string }>(
      `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`);
    const columns = new Map<string, string[]>();
    for (const row of metadata.rows) columns.set(row.table_name, [...(columns.get(row.table_name) ?? []), row.column_name]);
    const select = (table: string, names: string[]) => `SELECT ${names.map(name => `"${name}"`).join(",")} FROM "${table}" ORDER BY ${names.map(name => `"${name}"`).join(",")}`;
    const before = new Map<string, unknown>();
    for (const [table, names] of columns) before.set(table, (await target.query(select(table, names))).rows);
    const migration = await readFile(join("prisma", "migrations", "20261028110000_parking_lot", "migration.sql"), "utf8");
    await target.query(`CREATE TABLE "TopicParkingEvent" ("collision" INTEGER)`);
    await expect(target.query(migration)).rejects.toThrow(/already exists/);
    await target.query("ROLLBACK");
    expect((await target.query(`SELECT column_name FROM information_schema.columns WHERE table_name='TopicDiscussion' AND column_name='attemptNumber'`)).rowCount).toBe(0);
    await target.query(`DROP TABLE "TopicParkingEvent"`);
    await target.query(migration);
    for (const [table, names] of columns) expect((await target.query(select(table, names))).rows).toEqual(before.get(table));
    expect((await target.query(`SELECT "attemptNumber","outcome" FROM "TopicDiscussion" ORDER BY "sessionId"`)).rows)
      .toEqual([{ attemptNumber: 1, outcome: null }, { attemptNumber: 1, outcome: "DISCUSSED" }, { attemptNumber: 1, outcome: null }, { attemptNumber: 1, outcome: null }]);
    expect((await target.query(`SELECT * FROM "TopicParkingEvent"`)).rowCount).toBe(0);
    await expect(target.query(`UPDATE "TopicDiscussion" SET "attemptNumber"=0 WHERE "sessionId"='paused'`)).rejects.toThrow();
    await expect(target.query(`UPDATE "TopicDiscussion" SET "outcome"='DEFERRED' WHERE "sessionId"='paused'`)).rejects.toThrow();
    const start = `INSERT INTO "TopicDiscussion" ("teamId","sessionId","topicId","attemptNumber","state","deadlineAt","allocatedMs","startedAt","startedById")
      VALUES ('team','running','running2',1,'RUNNING','2099-01-01',300000,'2026-01-02','member')`;
    await expect(target.query(start)).rejects.toThrow(/one_current_per_session/);
    await target.query(`UPDATE "TopicDiscussion" SET "state"='FINISHED',"deadlineAt"=NULL,"remainingMs"=200001,"finishedAt"='2026-01-04',"finishedById"='member',"outcome"='DEFERRED' WHERE "sessionId"='running'`);
    const insertEvent = `INSERT INTO "TopicParkingEvent" ("teamId","sessionId","topicId","version","kind","reason","createdAt","actorId","attemptNumber")
      VALUES ($1,'running','running1',$2,$3,$4,'2026-01-04','member',$5)`;
    await target.query(insertEvent, ["team", 5, "PARK", "Keep reason", 1]);
    for (const values of [
      ["foreign", 6, "PARK", "", 1], ["team", 6, "PARK", "", 9],
      ["team", 6, "RESTORE", "Wrong", null], ["team", 6, "RESTORE", "", 1],
      ["team", 6, "PARK", "x".repeat(4001), null], ["team", 6, "PARK", " trailing ", null],
      ["team", 6, "PARK", "", 1]
    ]) await expect(target.query(insertEvent, values)).rejects.toThrow();
    await target.query(insertEvent, ["team", 6, "RESTORE", "", null]);
    await target.query(`INSERT INTO "TopicDiscussion" ("teamId","sessionId","topicId","attemptNumber","state","deadlineAt","allocatedMs","startedAt","startedById")
      VALUES ('team','running','running1',2,'RUNNING','2099-01-01',300000,'2026-01-05','member')`);
    expect((await target.query(`SELECT count(*)::int AS count FROM "TopicDiscussion" WHERE "sessionId"='running'`)).rows[0].count).toBe(2);
    await expect(target.query(`DELETE FROM "TopicDiscussion" WHERE "sessionId"='running' AND "attemptNumber"=1`)).rejects.toThrow();
    await expect(target.query(`INSERT INTO "TopicDiscussion" ("teamId","sessionId","topicId","attemptNumber","state","remainingMs","allocatedMs","startedAt","finishedAt","startedById","finishedById","outcome")
      VALUES ('team','finished','finished1',2,'FINISHED',0,300000,'2026-01-05','2026-01-06','member','member','DISCUSSED')`)).rejects.toThrow(/one_discussed_per_topic/);
  } finally {
    await target?.end();
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
