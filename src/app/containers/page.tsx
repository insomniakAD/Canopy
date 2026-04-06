import { db } from "@/lib/db";
import { Card, StatCard, Badge, TierBadge } from "@/components/ui";
import Link from "next/link";

// Helpers -----------------------------------------------------------------

function fmtNum(v: number, d = 1) {
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtInt(v: number) {
  return v.toLocaleString();
}

function fmtUsd(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function containerLabel(t: string) {
  return t === "forty_hq" ? "40HQ" : "40GP";
}

// Data loader -------------------------------------------------------------

interface ContainerPlanView {
  factoryId: string;
  factoryName: string;
  country: string;
  skus: {
    skuId: string;
    skuCode: string;
    skuName: string;
    tier: string;
    quantity: number;
    cartons: number;
    cbm: number;
    cost: number;
  }[];
  totalCbm: number;
  totalUnits: number;
  totalCost: number;
  containerType: string;
  containerCount: number;
  fillPct: number;
}

async function loadContainerData() {
  try {
    // Get all "order" recs — we'll group them by factory to build container views
    const recs = await db.reorderRecommendation.findMany({
      where: { isCurrent: true, decision: "order" },
      include: {
        sku: {
          select: {
            skuCode: true,
            name: true,
            tier: true,
            cbmPerCarton: true,
            unitsPerCarton: true,
            unitCostUsd: true,
          },
        },
        recommendedFactory: { select: { id: true, name: true, country: true } },
      },
      orderBy: { adjustedQuantity: "desc" },
    });

    // Container rules
    const rules = await db.containerRule.findMany();
    const ruleMap: Record<string, number> = {};
    for (const r of rules) {
      ruleMap[r.containerType] = Number(r.maxCbm);
    }
    const gpMax = ruleMap["forty_gp"] ?? 56;
    const hqMax = ruleMap["forty_hq"] ?? 68;

    // Group by factory
    const factoryMap = new Map<string, ContainerPlanView>();

    for (const r of recs) {
      const fId = r.recommendedFactory?.id ?? "unassigned";
      const fName = r.recommendedFactory?.name ?? "Unassigned";
      const fCountry = r.recommendedFactory?.country ?? "—";

      if (!factoryMap.has(fId)) {
        factoryMap.set(fId, {
          factoryId: fId,
          factoryName: fName,
          country: fCountry,
          skus: [],
          totalCbm: 0,
          totalUnits: 0,
          totalCost: 0,
          containerType: "forty_gp",
          containerCount: 1,
          fillPct: 0,
        });
      }

      const plan = factoryMap.get(fId)!;
      const qty = r.adjustedQuantity;
      const upc = r.sku.unitsPerCarton ?? 1;
      const cbmPc = r.sku.cbmPerCarton ? Number(r.sku.cbmPerCarton) : 0;
      const unitCost = r.sku.unitCostUsd ? Number(r.sku.unitCostUsd) : 0;
      const cartons = Math.ceil(qty / upc);
      const cbm = cartons * cbmPc;
      const cost = qty * unitCost;

      plan.skus.push({
        skuId: r.skuId,
        skuCode: r.sku.skuCode,
        skuName: r.sku.name,
        tier: r.sku.tier,
        quantity: qty,
        cartons,
        cbm,
        cost,
      });

      plan.totalCbm += cbm;
      plan.totalUnits += qty;
      plan.totalCost += cost;
    }

    // Determine container type and count per factory
    for (const plan of factoryMap.values()) {
      if (plan.totalCbm <= gpMax) {
        plan.containerType = "forty_gp";
        plan.containerCount = 1;
        plan.fillPct = (plan.totalCbm / gpMax) * 100;
      } else if (plan.totalCbm <= hqMax) {
        plan.containerType = "forty_hq";
        plan.containerCount = 1;
        plan.fillPct = (plan.totalCbm / hqMax) * 100;
      } else {
        plan.containerType = "forty_hq";
        plan.containerCount = Math.ceil(plan.totalCbm / hqMax);
        plan.fillPct = (plan.totalCbm / (plan.containerCount * hqMax)) * 100;
      }
    }

    const plans = Array.from(factoryMap.values()).sort((a, b) => b.totalCbm - a.totalCbm);
    const totalCbm = plans.reduce((s, p) => s + p.totalCbm, 0);
    const totalUnits = plans.reduce((s, p) => s + p.totalUnits, 0);
    const totalContainers = plans.reduce((s, p) => s + p.containerCount, 0);
    const totalCost = plans.reduce((s, p) => s + p.totalCost, 0);

    return { ok: true as const, plans, totalCbm, totalUnits, totalContainers, totalCost };
  } catch {
    return { ok: false as const };
  }
}

// Page --------------------------------------------------------------------

export default async function ContainerPlanningPage() {
  const data = await loadContainerData();

  if (!data.ok) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-[var(--c-text-primary)]">Container Planning</h1>
        <div className="mt-6 bg-[var(--c-warning-bg)] border border-[var(--c-warning-border)] rounded-xl px-6 py-5">
          <p className="font-semibold text-[var(--c-warning-text)]">Database not connected</p>
        </div>
      </div>
    );
  }

  const { plans, totalCbm, totalUnits, totalContainers, totalCost } = data;

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--c-text-primary)] mb-1">Container Planning</h1>
      <p className="text-sm text-[var(--c-text-secondary)] mb-6">
        How SKU orders group into containers by factory. Based on current &ldquo;Order&rdquo; recommendations.
      </p>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Factories" value={plans.length} />
        <StatCard label="Containers" value={totalContainers} accent="blue" />
        <StatCard label="Total CBM" value={fmtNum(totalCbm)} />
        <StatCard label="Total Cost" value={fmtUsd(totalCost)} />
      </div>

      {plans.length === 0 ? (
        <Card title="No Container Plans">
          <p className="text-sm text-[var(--c-text-tertiary)]">
            No SKUs are currently recommended for ordering. Import data and run recommendations first.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {plans.map((plan) => (
            <Card key={plan.factoryId}>
              {/* Factory header */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-[var(--c-text-primary)]">{plan.factoryName}</h3>
                  <p className="text-sm text-[var(--c-text-secondary)] capitalize">{plan.country}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">
                    {plan.containerCount}× {containerLabel(plan.containerType)}
                  </p>
                  <p className="text-xs text-[var(--c-text-secondary)]">
                    {fmtNum(plan.totalCbm)} / {fmtNum(plan.containerCount * (plan.containerType === "forty_hq" ? 68 : 56))} CBM
                  </p>
                </div>
              </div>

              {/* Fill bar */}
              <div className="mb-4">
                <div className="flex justify-between text-xs text-[var(--c-text-secondary)] mb-1">
                  <span>{fmtNum(plan.fillPct, 0)}% filled</span>
                  <span>{fmtInt(plan.totalUnits)} units &middot; {fmtUsd(plan.totalCost)}</span>
                </div>
                <div className="h-3 bg-[var(--c-border-row)] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      plan.fillPct >= 85 ? "bg-[var(--c-success)]" : plan.fillPct >= 60 ? "bg-[var(--c-accent)]" : "bg-[var(--c-warning)]"
                    }`}
                    style={{ width: `${Math.min(plan.fillPct, 100)}%` }}
                  />
                </div>
              </div>

              {/* SKU list */}
              <div className="overflow-x-auto -mx-6">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                      <th className="px-6 py-2 font-medium">SKU</th>
                      <th className="px-4 py-2 font-medium">Tier</th>
                      <th className="px-4 py-2 font-medium text-right">Qty</th>
                      <th className="px-4 py-2 font-medium text-right">Cartons</th>
                      <th className="px-4 py-2 font-medium text-right">CBM</th>
                      <th className="px-4 py-2 font-medium text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.skus.map((s) => (
                      <tr key={s.skuId} className="border-b border-[var(--c-border-row)]">
                        <td className="px-6 py-2">
                          <Link href={`/skus/${s.skuId}`} className="text-[var(--c-accent)] font-medium hover:underline">
                            {s.skuCode}
                          </Link>
                          <p className="text-xs text-[var(--c-text-tertiary)] truncate max-w-[180px]">{s.skuName}</p>
                        </td>
                        <td className="px-4 py-2"><TierBadge tier={s.tier} /></td>
                        <td className="px-4 py-2 text-right font-mono">{fmtInt(s.quantity)}</td>
                        <td className="px-4 py-2 text-right font-mono">{fmtInt(s.cartons)}</td>
                        <td className="px-4 py-2 text-right font-mono">{fmtNum(s.cbm, 2)}</td>
                        <td className="px-4 py-2 text-right font-mono">{fmtUsd(s.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
