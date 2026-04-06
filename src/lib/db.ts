// ============================================================================
// Database Client
// ============================================================================
// Use this everywhere in the app to access the database:
//
//   import { db } from "@/lib/db";
//   const skus = await db.sku.findMany();
//
// In development, this prevents creating a new database connection
// every time Next.js hot-reloads your code.
// ============================================================================

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
