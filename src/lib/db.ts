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
  const sslEnabled = process.env.DATABASE_SSL !== "false";
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
    ...(sslEnabled && { ssl: { rejectUnauthorized: false } }),
  });
  return new PrismaClient({ adapter });
}

// Reuse the same client across invocations within the same process.
// In dev this prevents a new pool on every hot-reload; in production
// (Vercel, etc.) it prevents a new pool on every warm invocation.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();
export const prisma = db; // Alias — both names work

globalForPrisma.prisma = db;
