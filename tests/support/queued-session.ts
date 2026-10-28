import { expect } from "vitest";
import pg from "pg";
import type { testDatabase } from "./database";

export async function queuedSession(
  db: ReturnType<typeof testDatabase>, sessionId: string,
  operations: (() => Promise<unknown>)[], commit?: (client: pg.Client) => Promise<unknown>
) {
  const blocker = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await blocker.connect();
  let outcomes: Promise<PromiseSettledResult<unknown>[]> | undefined;
  try {
    await blocker.query("BEGIN");
    const { rows } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await blocker.query(`SELECT "id" FROM "TeamSession" WHERE "id"=$1 FOR UPDATE`, [sessionId]);
    const queued: Promise<PromiseSettledResult<unknown>>[] = [];
    for (const operation of operations) {
      queued.push(operation().then(value => ({ status: "fulfilled", value }), reason => ({ status: "rejected", reason })));
      outcomes = Promise.all(queued);
      await expect.poll(async () => {
        const waiting = await db.$queryRaw<{ count: bigint }[]>`
          WITH RECURSIVE blocked(pid) AS (
            SELECT ${rows[0].pid}::integer
            UNION
            SELECT activity.pid FROM pg_stat_activity activity JOIN blocked
              ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
          ) SELECT count(*) - 1 AS count FROM blocked
        `;
        return Number(waiting[0].count);
      }).toBe(queued.length);
    }
    if (commit) await commit(blocker);
    await blocker.query("COMMIT");
    return outcomes ? await outcomes : [];
  } finally {
    await blocker.query("ROLLBACK");
    if (outcomes) await outcomes;
    await blocker.end();
  }
}
