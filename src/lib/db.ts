import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export const databaseReady = Promise.all([
  db.$queryRawUnsafe("PRAGMA journal_mode=WAL"),
  db.$queryRawUnsafe("PRAGMA foreign_keys=ON"),
  db.$queryRawUnsafe("PRAGMA busy_timeout=5000"),
  db.$queryRawUnsafe("PRAGMA synchronous=NORMAL"),
]).then(() => undefined);
