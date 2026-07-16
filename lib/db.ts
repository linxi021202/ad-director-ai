import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function databaseUrl() {
  const configured = process.env.DATABASE_URL?.trim();
  if (configured) return configured;

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return "postgresql://build@127.0.0.1:5432/build";
  }

  throw new Error("DATABASE_URL is required before using authenticated server features.");
}

function createPrismaClient() {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl() })
  });
}

export function getPrisma() {
  const client = globalForPrisma.prisma ?? createPrismaClient();

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
  }

  return client;
}
