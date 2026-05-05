import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const VALID_TIERS = new Set(["A", "B", "C", "LP"]);

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const text = await (file as File).text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());

    if (lines.length < 2) {
      return NextResponse.json({ error: "File is empty or has no data rows" }, { status: 400 });
    }

    // Parse header row — find SKU Code and Tier column indices
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/['"]/g, ""));
    const skuCol = headers.findIndex((h) => h === "sku code" || h === "sku_code" || h === "skucode");
    const tierCol = headers.findIndex((h) => h === "tier");

    if (skuCol === -1 || tierCol === -1) {
      return NextResponse.json({
        error: `CSV must have "SKU Code" and "Tier" columns. Found: ${headers.join(", ")}`,
      }, { status: 400 });
    }

    // Parse data rows
    const rows: Array<{ skuCode: string; tier: string }> = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
      const skuCode = cols[skuCol]?.trim();
      const tier = cols[tierCol]?.trim().toUpperCase();
      if (skuCode && tier && VALID_TIERS.has(tier)) {
        rows.push({ skuCode, tier });
      }
    }

    if (rows.length === 0) {
      return NextResponse.json({
        error: "No valid rows found. Ensure Tier values are A, B, C, or LP.",
      }, { status: 400 });
    }

    // Match SKU codes to IDs
    const skuCodes = [...new Set(rows.map((r) => r.skuCode))];
    const skus = await prisma.sku.findMany({
      where: { skuCode: { in: skuCodes }, status: "active" },
      select: { id: true, skuCode: true, tier: true },
    });
    const skuMap = new Map(skus.map((s) => [s.skuCode, s]));

    const matched = rows.filter((r) => skuMap.has(r.skuCode));
    const skipped = rows.length - matched.length;

    if (matched.length === 0) {
      return NextResponse.json({
        error: "No SKU codes matched active SKUs in the database.",
      }, { status: 400 });
    }

    // Generate run label
    const year = new Date().getFullYear().toString();
    const existingRuns = await prisma.tierSnapshot.findMany({
      where: { runLabel: { startsWith: year } },
      select: { runLabel: true },
      distinct: ["runLabel"],
    });
    const runLabel = existingRuns.length === 0 ? year : `${year}-${existingRuns.length + 1}`;

    // Build snapshot records
    const tierCounts: Record<string, number> = { A: 0, B: 0, C: 0, LP: 0 };
    for (const row of matched) {
      const sku = skuMap.get(row.skuCode)!;
      await prisma.tierSnapshot.create({
        data: {
          skuId: sku.id,
          runLabel,
          tier: row.tier as "A" | "B" | "C" | "LP",
          previousTier: sku.tier,
          trailingRevenueUsd: 0,
          revenueRankPct: 0,
          isActive: false,
        },
      });
      tierCounts[row.tier] = (tierCounts[row.tier] ?? 0) + 1;
    }

    return NextResponse.json({
      runLabel,
      totalSkus: matched.length,
      skipped,
      tierCounts,
    });
  } catch (err) {
    console.error("Tier upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
