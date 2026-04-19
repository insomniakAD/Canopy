"use client";

import { ExportButton } from "@/components/export-button";

interface ContainerSku {
  skuCode: string;
  skuName: string;
  tier: string;
  quantity: number;
  fclQty40GP: number | null;
  fclQty40HQ: number | null;
  fraction40HQ: number | null;
  hint: string;
  cost: number;
}

interface FactoryPlan {
  factoryName: string;
  country: string;
  estimatedContainers: number | null;
  totalFractionHQ: number;
  skus: ContainerSku[];
}

export function ContainerExport({ plans }: { plans: FactoryPlan[] }) {
  const data = plans.flatMap((plan) =>
    plan.skus.map((s) => ({
      Factory: plan.factoryName,
      Country: plan.country,
      "Est. Containers (40HQ)": plan.estimatedContainers ?? "",
      "Factory 40HQ Load Fraction": plan.totalFractionHQ.toFixed(2),
      SKU: s.skuCode,
      "SKU Name": s.skuName,
      Tier: s.tier,
      Quantity: s.quantity,
      "FCL 40GP": s.fclQty40GP ?? "",
      "FCL 40HQ": s.fclQty40HQ ?? "",
      "40HQ Fraction": s.fraction40HQ != null ? s.fraction40HQ.toFixed(2) : "",
      Hint: s.hint,
      Cost: s.cost.toFixed(0),
    })),
  );

  return <ExportButton data={data} filename="canopy-container-plan.csv" />;
}
