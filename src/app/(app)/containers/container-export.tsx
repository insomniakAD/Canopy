"use client";

import { ExportButton } from "@/components/export-button";

interface ContainerSku {
  skuCode: string;
  skuName: string;
  tier: string;
  quantity: number;
  cartons: number;
  cbm: number;
  cost: number;
}

interface FactoryPlan {
  factoryName: string;
  country: string;
  skus: ContainerSku[];
}

export function ContainerExport({ plans }: { plans: FactoryPlan[] }) {
  const data = plans.flatMap((plan) =>
    plan.skus.map((s) => ({
      Factory: plan.factoryName,
      Country: plan.country,
      SKU: s.skuCode,
      Tier: s.tier,
      Quantity: s.quantity,
      Cartons: s.cartons,
      CBM: s.cbm.toFixed(2),
      Cost: s.cost.toFixed(0),
    })),
  );

  return <ExportButton data={data} filename="canopy-container-plan.csv" />;
}
