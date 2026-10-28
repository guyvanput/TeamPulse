import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import { it, expect } from "vitest";
import { testDatabase } from "../support/database";

it("TD8: timer migration preserves every existing column/row and enforces scoped current/timing constraints", async () => {
  const guard = testDatabase();
  await guard.$disconnect();
  const url = new URL(process.env.TEST_DATABASE_URL!);
  const name = `discussion_migration_${randomUUID().replaceAll("-", "")}_test`;
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
    for (const migration of ["20261026120000_initial", "20261027100000_facilitated_topics", "20261028090000_topic_voting"]) {
      await target.query(await readFile(join("prisma", "migrations", migration, "migration.sql"), "utf8"));
    }
    await target.query(`
      INSERT INTO "User" ("id","name") VALUES ('member','Synthetic member'),('other','Synthetic other');
      INSERT INTO "Account" ("id","userId","type","provider","providerAccountId") VALUES ('account','member','oauth','github','synthetic-only');
      INSERT INTO "Session" ("id","userId","sessionToken","expires") VALUES ('auth','member','synthetic-only','2099-01-01');
      INSERT INTO "VerificationToken" ("identifier","token","expires") VALUES ('synthetic','verification','2099-01-01');
      INSERT INTO "Team" ("id","name") VALUES ('team','Synthetic team'),('otherteam','Other team');
      INSERT INTO "Membership" ("teamId","userId") VALUES ('team','member'),('otherteam','other');
      INSERT INTO "TeamSession" ("id","teamId","title") VALUES ('legacy','team','Legacy'),('later','team','Later');
      INSERT INTO "TeamSession" ("id","teamId","title","kind","facilitatorId","collectionState","closedAt","lifecycleVersion","votingState","votingStartedAt","votingFinalizedAt")
        VALUES ('final','team','Final','FACILITATED','member','PAUSED',NULL,3,'FINALIZED','2026-01-01','2026-01-02'),
        ('closed','team','Closed','FACILITATED','member','CLOSED',CURRENT_TIMESTAMP,4,'FINALIZED','2026-01-01','2026-01-02'),
        ('open','team','Open','FACILITATED','member','PAUSED',NULL,2,'OPEN','2026-01-01',NULL),
        ('foreign','otherteam','Foreign','FACILITATED','other','COLLECTING',NULL,0,'NOT_STARTED',NULL,NULL);
      INSERT INTO "SessionParticipant" ("teamId","sessionId","userId","ballotVersion") VALUES
        ('team','final','member',1),('team','open','member',1),('otherteam','foreign','other',0);
      INSERT INTO "Topic" ("id","teamId","sessionId","authorId","title","description","updatedAt","version","removedAt","removedById") VALUES
        ('a','team','final','member','First','Keep',CURRENT_TIMESTAMP,2,NULL,NULL),
        ('b','team','final','member','Second','Keep',CURRENT_TIMESTAMP,1,NULL,NULL),
        ('removed','team','closed','member','Removed','Keep removal',CURRENT_TIMESTAMP,3,CURRENT_TIMESTAMP,'member'),
        ('open-topic','team','open','member','Open','Keep',CURRENT_TIMESTAMP,0,NULL,NULL);
      INSERT INTO "TopicVote" ("teamId","sessionId","userId","topicId") VALUES ('team','final','member','a'),('team','open','member','open-topic');
      INSERT INTO "AgendaEntry" ("teamId","sessionId","topicId","position","voteCount") VALUES ('team','final','a',1,1),('team','final','b',2,0);
      INSERT INTO "Action" ("id","teamId","sourceSessionId","ownerId","title","context","updatedAt","status")
        VALUES ('action','team','legacy','member','Keep action','Keep context',CURRENT_TIMESTAMP,'IN_PROGRESS');
      INSERT INTO "ActionReview" ("id","teamId","actionId","reviewSessionId","actorId","note","resultingStatus")
        VALUES ('review','team','action','later','member','Keep note','IN_PROGRESS');
    `);
    const metadata = await target.query<{ table_name: string; column_name: string }>(
      `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`
    );
    const columns = new Map<string, string[]>();
    for (const row of metadata.rows) columns.set(row.table_name, [...(columns.get(row.table_name) ?? []), row.column_name]);
    const select = (table: string, names: string[]) => `SELECT ${names.map(name => `"${name}"`).join(",")} FROM "${table}" ORDER BY ${names.map(name => `"${name}"`).join(",")}`;
    const before = new Map<string, unknown>();
    for (const [table, names] of columns) before.set(table, (await target.query(select(table, names))).rows);
    await target.query(await readFile(join("prisma", "migrations", "20261028100000_timed_topic_discussion", "migration.sql"), "utf8"));
    for (const [table, names] of columns) expect((await target.query(select(table, names))).rows).toEqual(before.get(table));
    expect((await target.query(`SELECT * FROM "TopicDiscussion"`)).rowCount).toBe(0);
    const insert = `INSERT INTO "TopicDiscussion" ("teamId","sessionId","topicId","state","deadlineAt","allocatedMs","startedAt","startedById")
      VALUES ($1,'final',$2,'RUNNING',CURRENT_TIMESTAMP + INTERVAL '5 minutes',300000,CURRENT_TIMESTAMP,'member')`;
    await expect(target.query(insert, ["otherteam", "a"])).rejects.toThrow();
    await target.query(insert, ["team", "a"]);
    await expect(target.query(insert, ["team", "b"])).rejects.toThrow(/TopicDiscussion_one_current_per_session/);
    await expect(target.query(`UPDATE "TopicDiscussion" SET "state"='PAUSED',"deadlineAt"=NULL,"remainingMs"=0`)).rejects.toThrow();
    await expect(target.query(`UPDATE "TopicDiscussion" SET "state"='FINISHED',"deadlineAt"=NULL,"remainingMs"=0`)).rejects.toThrow();
    await target.query(`UPDATE "TopicDiscussion" SET "state"='FINISHED',"deadlineAt"=NULL,"remainingMs"=0,"finishedAt"=CURRENT_TIMESTAMP,"finishedById"='member'`);
    await target.query(insert, ["team", "b"]);
    expect((await target.query(`SELECT count(*)::int AS count FROM "TopicDiscussion"`)).rows[0].count).toBe(2);
  } finally {
    await target?.end();
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
