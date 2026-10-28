import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import { it, expect } from "vitest";
import { testDatabase } from "../support/database";

it("TC11: additive migration preserves every original column and row", async () => {
  const guard = testDatabase();
  await guard.$disconnect();
  const base = new URL(process.env.TEST_DATABASE_URL!);
  const name = `topic_migration_${randomUUID().replaceAll("-", "")}_test`;
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
    await target.query(await readFile(join("prisma", "migrations", "20261026120000_initial", "migration.sql"), "utf8"));
    await target.query(`
      INSERT INTO "User" ("id","name") VALUES ('member','Synthetic migration member');
      INSERT INTO "Team" ("id","name") VALUES ('team','Synthetic migration team');
      INSERT INTO "Membership" ("teamId","userId") VALUES ('team','member');
      INSERT INTO "TeamSession" ("id","teamId","title") VALUES ('first','team','Original'),('later','team','Later');
      INSERT INTO "Action" ("id","teamId","sourceSessionId","ownerId","title","context","updatedAt")
        VALUES ('action','team','first','member','Keep action','Keep context',CURRENT_TIMESTAMP);
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
      before.set(table, (await target.query(`SELECT ${names.map(name => `"${name}"`).join(",")} FROM "${table}" ORDER BY 1`)).rows);
    }
    await target.query(await readFile(join("prisma", "migrations", "20261027100000_facilitated_topics", "migration.sql"), "utf8"));
    for (const [table, names] of columns) {
      expect((await target.query(`SELECT ${names.map(name => `"${name}"`).join(",")} FROM "${table}" ORDER BY 1`)).rows).toEqual(before.get(table));
    }
    expect((await target.query(`SELECT "kind","facilitatorId","collectionState" FROM "TeamSession"`)).rows)
      .toEqual(Array(2).fill({ kind: "ACTION_FOLLOW_UP", facilitatorId: null, collectionState: null }));
    await expect(target.query(`UPDATE "TeamSession" SET "kind"='FACILITATED' WHERE "id"='first'`)).rejects.toThrow();
  } finally {
    await target?.end();
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
