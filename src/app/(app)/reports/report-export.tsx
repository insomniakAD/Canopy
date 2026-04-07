"use client";

import { ExportButton } from "@/components/export-button";

interface StockoutRisk {
  skuCode: string;
  tier: string;
  wos: number;
  targetWos: number;
  qty: number;
  stockoutDate: string | null;
}

interface CountryRow {
  country: string;
  skus: number;
  units: number;
  cbm: number;
  cost: number;
}

export function StockoutExport({ risks }: { risks: StockoutRisk[] }) {
  const data = risks.map((r) => ({
    SKU: r.skuCode,
    Tier: r.tier,
    "Weeks of Supply": r.wos.toFixed(1),
    "Target WOS": r.targetWos.toFixed(1),
    "Order Qty": r.qty,
    "Stockout Date": r.stockoutDate ?? "",
  }));

  return <ExportButton data={data} filename="canopy-stockout-risks.csv" label="Export Stockout Risks" />;
}

export function CountryExport({ rows }: { rows: CountryRow[] }) {
  const data = rows.map((c) => ({
    Country: c.country,
    SKUs: c.skus,
    Units: c.units,
    CBM: c.cbm.toFixed(1),
    Cost: c.cost.toFixed(0),
  }));

  return <ExportButton data={data} filename="canopy-orders-by-country.csv" label="Export Orders by Country" />;
}
