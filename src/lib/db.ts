import "server-only";
import { PrismaClient } from "@prisma/client";
import { databaseClient } from "./client";

const globalDb = globalThis as typeof globalThis & { prisma?: PrismaClient };
export const db = globalDb.prisma ?? databaseClient();
if (process.env.NODE_ENV !== "production") globalDb.prisma = db;
