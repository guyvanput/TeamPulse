import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import { it, expect } from "vitest";
import { testDatabase } from "../support/database";

it("VP10: voting migration preserves every original column/row and enforces scoped constraints", async () => {
  const guard = testDatabase();
  await guard.$disconnect();
  const base = new URL(process.env.TEST_DATABASE_URL!);
  const name = `voting_migration_${randomUUID().replaceAll("-", "")}_test`;
  const admin = new pg.Client({ connectionString: base.href });
  let target: pg.Client | undefined;
  let created = false;
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    base.pathname = `/${name}`;
    target = new pg.Client({ connectionString: base.href });
    await target.connect();
    for (const migration of ["20261026120000_initial", "20261027100000_facilitated_topics"]) {
      await target.query(await readFile(join("prisma", "migrations", migration, "migration.sql"), "utf8"));
    }
    await target.query(`
      INSERT INTO "User" ("id","name") VALUES ('member','Synthetic member'),('other','Synthetic other');
      INSERT INTO "Account" ("id","userId","type","provider","providerAccountId")
        VALUES ('account','member','oauth','github','synthetic-only');
      INSERT INTO "Session" ("id","userId","sessionToken","expires")
        VALUES ('auth','member','synthetic-only-token','2099-01-01');
      INSERT INTO "VerificationToken" ("identifier","token","expires")
        VALUES ('synthetic','synthetic-verification','2099-01-01');
      INSERT INTO "Team" ("id","name") VALUES ('team','Synthetic team'),('otherteam','Other team');
      INSERT INTO "Membership" ("teamId","userId") VALUES ('team','member'),('otherteam','other');
      INSERT INTO "TeamSession" ("id","teamId","title")
        VALUES ('legacy','team','Legacy'),('later','team','Later');
      INSERT INTO "TeamSession" ("id","teamId","title","kind","facilitatorId","collectionState","closedAt","lifecycleVersion")
        VALUES ('collecting','team','Collecting','FACILITATED','member','COLLECTING',NULL,0),
        ('paused','team','Paused','FACILITATED','member','PAUSED',NULL,3),
        ('closed','team','Closed','FACILITATED','member','CLOSED',CURRENT_TIMESTAMP,5),
        ('other','otherteam','Foreign','FACILITATED','other','COLLECTING',NULL,0);
      INSERT INTO "SessionParticipant" ("teamId","sessionId","userId")
        VALUES ('team','collecting','member'),('team','closed','member'),('otherteam','other','other');
      INSERT INTO "Topic" ("id","teamId","sessionId","authorId","title","description","updatedAt","version","removedAt","removedById")
        VALUES ('active','team','collecting','member','Active','Keep',CURRENT_TIMESTAMP,2,NULL,NULL),
        ('removed','team','closed','member','Removed','Keep removal',CURRENT_TIMESTAMP,3,CURRENT_TIMESTAMP,'member'),
        ('foreign','otherteam','other','other','Foreign','Other',CURRENT_TIMESTAMP,0,NULL,NULL);
      INSERT INTO "Action" ("id","teamId","sourceSessionId","ownerId","title","context","updatedAt","status")
        VALUES ('action','team','legacy','member','Keep action','Keep context',CURRENT_TIMESTAMP,'IN_PROGRESS');
      INSERT INTO "ActionReview" ("id","teamId","actionId","reviewSessionId","actorId","note","resultingStatus")
        VALUES ('review','team','action','later','member','Keep note','IN_PROGRESS');
    `);
    const tables = await target.query<{ table_name: string; column_name: string }>(
      `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`
    );
    const columns = new Map<string, string[]>();
    for (const row of tables.rows) columns.set(row.table_name, [...(columns.get(row.table_name) ?? []), row.column_name]);
    const before = new Map<string, unknown>();
    for (const [table, names] of columns) {
      before.set(table, (await target.query(`SELECT ${names.map(name => `"${name}"`).join(",")} FROM "${table}" ORDER BY ${names.map(name => `"${name}"`).join(",")}`)).rows);
    }
    await target.query(await readFile(join("prisma", "migrations", "20261028090000_topic_voting", "migration.sql"), "utf8"));
    for (const [table, names] of columns) {
      expect((await target.query(`SELECT ${names.map(name => `"${name}"`).join(",")} FROM "${table}" ORDER BY ${names.map(name => `"${name}"`).join(",")}`)).rows).toEqual(before.get(table));
    }
    expect((await target.query(`SELECT DISTINCT "votingState","votingStartedAt","votingFinalizedAt" FROM "TeamSession"`)).rows)
      .toEqual([{ votingState: "NOT_STARTED", votingStartedAt: null, votingFinalizedAt: null }]);
    expect((await target.query(`SELECT DISTINCT "ballotVersion" FROM "SessionParticipant"`)).rows).toEqual([{ ballotVersion: 0 }]);
    expect((await target.query(`SELECT * FROM "TopicVote"`)).rowCount).toBe(0);
    expect((await target.query(`SELECT * FROM "AgendaEntry"`)).rowCount).toBe(0);
    await expect(target.query(`UPDATE "TeamSession" SET "votingState"='OPEN',"votingStartedAt"=CURRENT_TIMESTAMP WHERE "id"='legacy'`)).rejects.toThrow();
    await expect(target.query(`UPDATE "TeamSession" SET "votingState"='OPEN',"votingStartedAt"=CURRENT_TIMESTAMP WHERE "id"='collecting'`)).rejects.toThrow();
    await expect(target.query(`UPDATE "SessionParticipant" SET "ballotVersion"=-1`)).rejects.toThrow();
    await expect(target.query(`INSERT INTO "TopicVote" ("teamId","sessionId","userId","topicId") VALUES ('team','collecting','member','foreign')`)).rejects.toThrow();
    await expect(target.query(`INSERT INTO "AgendaEntry" ("teamId","sessionId","topicId","position","voteCount") VALUES ('team','collecting','active',0,0)`)).rejects.toThrow();
  } finally {
    await target?.end();
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
