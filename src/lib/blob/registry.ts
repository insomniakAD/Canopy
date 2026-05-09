// ============================================================================
// Blob Source Registry
// ============================================================================
// Catalog of files in Golf's Vercel Blob storage that Canopy knows how to
// import. The /admin/sync page lists these; the sync API dispatches by key.
//
// To add a new blob source:
//   1. Add an entry below.
//   2. Wire its key in the sync API's preview dispatcher.

import type { ImportType } from "@/generated/prisma/client";

export type BlobSourceKey =
  | "oitem-monthly"
  | "purchase-orders"
  | "pitem"
  | "parthist-daily";

export type BlobSourceDefinition = {
  key: BlobSourceKey;
  /** One or more pathnames in Golf's blob. Multiple = files are joined. */
  pathnames: string[];
  label: string;
  description: string;
  importType: ImportType;
};

export const BLOB_REGISTRY: Record<BlobSourceKey, BlobSourceDefinition> = {
  "oitem-monthly": {
    key: "oitem-monthly",
    pathnames: ["oitem-monthly.json"],
    label: "WDS Monthly Sales — Cartons",
    description:
      "Per-SKU monthly unit sales (qtyOrd) from Golf's oitem-monthly export. " +
      "Replaces the manual WDS Monthly Sales (Cartons) Excel upload.",
    importType: "wds_monthly_cartons",
  },
  "purchase-orders": {
    key: "purchase-orders",
    pathnames: ["porder-recent.json", "cont-det.json"],
    label: "WDS Factory POs",
    description:
      "Factory purchase orders. Joins porder-recent.json (PO header: vendor, " +
      "dates, total cost) with cont-det.json (line items: SKU + qty per PO). " +
      "Closed POs are imported as 'received' for audit; open POs as 'ordered'.",
    importType: "purchase_orders",
  },
  "pitem": {
    key: "pitem",
    pathnames: ["pitem.json"],
    label: "WDS PO Line Items",
    description:
      "Authoritative PO line composition from WDS. Per-line ETD/ETA, " +
      "qty ordered/received/cancelled/remaining, factory + warehouse " +
      "vs. Amazon DI flag. Replaces porder + cont-det for per-SKU views.",
    importType: "wds_pitem",
  },
  "parthist-daily": {
    key: "parthist-daily",
    pathnames: ["parthist-daily.json"],
    label: "WDS Daily Inventory",
    description:
      "Per-SKU daily warehouse on-hand snapshots from WDS. Weekday-only " +
      "history starting 2025-06-23 for ~700 EDI-feed SKUs. LOC 1 only.",
    importType: "wds_parthist_daily",
  },
};

export const BLOB_SOURCES: BlobSourceDefinition[] = Object.values(BLOB_REGISTRY);

export function getBlobSource(key: string): BlobSourceDefinition | null {
  return key in BLOB_REGISTRY
    ? BLOB_REGISTRY[key as BlobSourceKey]
    : null;
}

/**
 * Canonical pathname stored in BlobSync.pathname so each source has a stable
 * key to look up its sync history. For multi-file sources we use the first
 * (primary) pathname.
 */
export function canonicalPathname(source: BlobSourceDefinition): string {
  return source.pathnames[0];
}
