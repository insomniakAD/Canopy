// ============================================================================
// API Route: /api/search
// ============================================================================
// GET ?q=<term> — typeahead search across SKUs, POs, and Lot numbers.
// Returns up to 5 of each so the dropdown stays compact.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";

const PER_TYPE_LIMIT = 5;

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return Response.json({ skus: [], pos: [] });
  }

  const [skus, posByNumber, posByLot] = await Promise.all([
    db.sku.findMany({
      where: {
        OR: [
          { skuCode: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, skuCode: true, name: true, isKitParent: true },
      orderBy: { skuCode: "asc" },
      take: PER_TYPE_LIMIT,
    }),
    db.purchaseOrder.findMany({
      where: { poNumber: { contains: q, mode: "insensitive" } },
      select: {
        id: true,
        poNumber: true,
        lotNumber: true,
        status: true,
        factory: { select: { name: true } },
      },
      orderBy: { poNumber: "asc" },
      take: PER_TYPE_LIMIT,
    }),
    db.purchaseOrder.findMany({
      where: { lotNumber: { contains: q, mode: "insensitive" } },
      select: {
        id: true,
        poNumber: true,
        lotNumber: true,
        status: true,
        factory: { select: { name: true } },
      },
      orderBy: { lotNumber: "asc" },
      take: PER_TYPE_LIMIT,
    }),
  ]);

  // Merge PO matches (number + lot) with PO id as the dedupe key.
  const poById = new Map<string, (typeof posByNumber)[number]>();
  for (const p of posByNumber) poById.set(p.id, p);
  for (const p of posByLot) if (!poById.has(p.id)) poById.set(p.id, p);

  return Response.json({
    skus: skus.map((s) => ({
      id: s.id,
      skuCode: s.skuCode,
      name: s.name,
      isKitParent: s.isKitParent,
    })),
    pos: Array.from(poById.values()).slice(0, PER_TYPE_LIMIT * 2).map((p) => ({
      id: p.id,
      poNumber: p.poNumber,
      lotNumber: p.lotNumber,
      status: p.status,
      factoryName: p.factory?.name ?? null,
    })),
  });
}
