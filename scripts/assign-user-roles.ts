/**
 * Idempotent role assignment for Canopy admin/buyer users.
 *
 * Run on existing databases (prod / dev) to ensure the three named users
 * exist with the right roles. Safe to re-run: only upserts these users,
 * does not touch anything else.
 *
 * Usage: npx tsx scripts/assign-user-roles.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Load .env manually if DATABASE_URL isn't in the process environment.
// tsx doesn't auto-load .env the way the Prisma CLI does.
if (!process.env.DATABASE_URL) {
  try {
    const envPath = resolve(process.cwd(), ".env");
    const contents = readFileSync(envPath, "utf8");
    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // fall through — PrismaPg will error clearly if DATABASE_URL still missing
  }
}

const USERS = [
  { email: "papp@winsome.com", name: "papp", role: "admin" as const },
  { email: "golf@winsome.com", name: "golf", role: "admin" as const },
  { email: "buyer-test@winsome.com", name: "buyer-test", role: "buyer" as const },
];

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });
  try {
    for (const u of USERS) {
      const result = await prisma.user.upsert({
        where: { email: u.email },
        update: { name: u.name, role: u.role, isActive: true },
        create: { email: u.email, name: u.name, role: u.role },
      });
      console.log(`  ✓ ${result.name.padEnd(12)} → ${result.role}`);
    }
    console.log("\nDone. All three users are present with correct roles.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
