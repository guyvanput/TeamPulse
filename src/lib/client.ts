import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { attachDatabasePool } from "@vercel/functions";
import pg from "pg";

export function databaseClient(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is required.");
  const pool = new pg.Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 15000
  });
  if (process.env.VERCEL === "1") attachDatabasePool(pool);
  return new PrismaClient({
    adapter: new PrismaPg(pool, {
      disposeExternalPool: true,
      onPoolError: () => { console.error("Database pool connection failed."); },
      onConnectionError: () => { console.error("Database connection failed."); }
    })
  });
}
