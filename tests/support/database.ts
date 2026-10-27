import { randomUUID } from "node:crypto";
import { databaseClient } from "../../src/lib/client";

export function testDatabase() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required. Tests never fall back to the application database.");
  const parsed = new URL(url);
  const local = ["localhost", "127.0.0.1", "postgres"].includes(parsed.hostname);
  const isolatedNeon = parsed.hostname.endsWith(".neon.tech") &&
    parsed.hostname === process.env.NEON_TEST_DATABASE_HOST;
  if (!parsed.pathname.endsWith("_test") || (!local && !isolatedNeon)) {
    throw new Error("Tests require a local _test database or an explicitly pinned isolated Neon _test database.");
  }
  return databaseClient(url);
}

export async function fixture(db: ReturnType<typeof testDatabase>) {
  const prefix = randomUUID();
  const alice = await db.user.create({ data: { name: `Alice ${prefix}` } });
  const bob = await db.user.create({ data: { name: `Bob ${prefix}` } });
  const alpha = await db.team.create({ data: { name: `Alpha ${prefix}`, memberships: { create: { userId: alice.id } } } });
  const beta = await db.team.create({ data: { name: `Beta ${prefix}`, memberships: { create: { userId: bob.id } } } });
  return { alice, bob, alpha, beta };
}

export async function cleanFixture(db: ReturnType<typeof testDatabase>, data: Awaited<ReturnType<typeof fixture>>) {
  const teamId = { in: [data.alpha.id, data.beta.id] };
  await db.actionReview.deleteMany({ where: { teamId } });
  await db.action.deleteMany({ where: { teamId } });
  await db.teamSession.deleteMany({ where: { teamId } });
  await db.membership.deleteMany({ where: { teamId } });
  await db.team.deleteMany({ where: { id: teamId } });
  await db.user.deleteMany({ where: { id: { in: [data.alice.id, data.bob.id] } } });
}
