/**
 * Idempotent role assignment for Canopy admin/buyer users.
 *
 * Run on existing databases (prod / dev) to ensure the three named users
 * exist with the right roles. Safe to re-run: only upserts these users,
 * does not touch anything else.
 *
 * Usage: npx tsx scripts/assign-user-roles.ts
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

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
