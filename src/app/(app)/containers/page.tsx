import { db } from "@/lib/db";
import { Card, StatCard, TierBadge } from "@/components/ui";
import Link from "next/link";
import { ContainerExport } from "./container-export";
import { calculateFclHint } from "@/lib/reorder/container";

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

function hintLabel(hint: string): string {
  switch (hint) {
    case "lcl":
      return "Well below 1 FCL";
    case "round_up_to_fcl":
      return "Near 1 FCL — consider rounding up";
    case "fcl":
      return "Partial load above 1 FCL";
    case "multi_fcl":
      return "Near integer number of FCLs";
    default:
      return "Unknown (no FCL qty on file)";
  }
}

// Data loader -------------------------------------------------------------

interface ContainerSkuLine {
  skuId: string;
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

interface FactoryPlanView {
  factoryId: string;
  factoryName: string;
  country: string;
  skus: ContainerSkuLine[];
  totalUnits: number;
  totalCost: number;
  totalFractionHQ: number;
  estimatedContainers: number | null;
  skusMissingFcl: number;
}

async function loadContainerData() {
  try {
    const recs = await db.reorderRecommendation.findMany({
      where: { isCurrent: true, decision: "order" },
      include: {
        sku: {
          select: {
            skuCode: true,
            name: true,
            tier: true,
            fclQty40GP: true,
            fclQty40HQ: true,
            unitCostUsd: true,
          },
        },
        recommendedFactory: { select: { id: true, name: true, country: true } },
      },
      orderBy: { adjustedQuantity: "desc" },
    });

    const factoryMap = new Map<string, FactoryPlanView>();

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
          totalUnits: 0,
          totalCost: 0,
          totalFractionHQ: 0,
          estimatedContainers: null,
          skusMissingFcl: 0,
        });
      }

      const plan = factoryMap.get(fId)!;
      const qty = r.adjustedQuantity;
      const fclGp = r.sku.fclQty40GP ?? null;
      const fclHq = r.sku.fclQty40HQ ?? null;
      const unitCost = r.sku.unitCostUsd ? Number(r.sku.unitCostUsd) : 0;
      const cost = qty * unitCost;
      const { fraction40HQ, hint } = calculateFclHint(qty, fclHq);

      plan.skus.push({
        skuId: r.skuId,
        skuCode: r.sku.skuCode,
        skuName: r.sku.name,
        tier: r.sku.tier,
        quantity: qty,
        fclQty40GP: fclGp,
        fclQty40HQ: fclHq,
        fraction40HQ: fraction40HQ != null ? Math.round(fraction40HQ * 100) / 100 : null,
        hint,
        cost,
      });

      plan.totalUnits += qty;
      plan.totalCost += cost;
      if (fraction40HQ != null) {
        plan.totalFractionHQ += fraction40HQ;
      } else {
        plan.skusMissingFcl++;
      }
    }

    for (const plan of factoryMap.values()) {
      plan.totalFractionHQ = Math.round(plan.totalFractionHQ * 100) / 100;
      plan.estimatedContainers =
        plan.totalFractionHQ > 0 ? Math.max(1, Math.ceil(plan.totalFractionHQ)) : null;
    }

    const plans = Array.from(factoryMap.values()).sort(
      (a, b) => b.totalFractionHQ - a.totalFractionHQ
    );
    const totalUnits = plans.reduce((s, p) => s + p.totalUnits, 0);
    const totalCost = plans.reduce((s, p) => s + p.totalCost, 0);
    const totalFractionHQ =
      Math.round(plans.reduce((s, p) => s + p.totalFractionHQ, 0) * 100) / 100;
    const totalContainers = plans.reduce((s, p) => s + (p.estimatedContainers ?? 0), 0);

    return {
      ok: true as const,
      plans,
      totalFractionHQ,
      totalUnits,
      totalContainers,
      totalCost,
    };
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

  const { plans, totalFractionHQ, totalUnits, totalContainers, totalCost } = data;

  return (
    <div>
      <div className="flex items-start justify-between mb-1">
        <h1 className="text-2xl font-bold text-[var(--c-text-primary)]">Container Planning</h1>
        <ContainerExport plans={plans} />
      </div>
      <p className="text-sm text-[var(--c-text-secondary)] mb-6">
        Rough container load by factory. Each SKU&apos;s order is compared to its 40HQ FCL quantity — summed per factory to estimate container count. Factories confirm 40GP vs 40HQ at load.
      </p>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <StatCard label="Factories" value={plans.length} />
        <StatCard label="Est. Containers" value={totalContainers} accent="blue" sub="rounded up per factory" />
        <StatCard label="40HQ Fraction" value={fmtNum(totalFractionHQ, 2)} sub="sum across SKUs" />
        <StatCard label="Total Units" value={fmtInt(totalUnits)} />
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
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-[var(--c-text-primary)]">{plan.factoryName}</h3>
                  <p className="text-sm text-[var(--c-text-secondary)] capitalize">{plan.country}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">
                    {plan.estimatedContainers != null
                      ? `~${plan.estimatedContainers}× 40HQ (est.)`
                      : "No FCL data"}
                  </p>
                  <p className="text-xs text-[var(--c-text-secondary)]">
                    Load fraction: {fmtNum(plan.totalFractionHQ, 2)}× 40HQ
                    {plan.skusMissingFcl > 0 && ` · ${plan.skusMissingFcl} SKU${plan.skusMissingFcl === 1 ? "" : "s"} without FCL qty`}
                  </p>
                </div>
              </div>

              <div className="mb-4 flex justify-between text-xs text-[var(--c-text-secondary)]">
                <span>{fmtInt(plan.totalUnits)} units</span>
                <span>{fmtUsd(plan.totalCost)}</span>
              </div>

              <div className="overflow-x-auto -mx-6">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                      <th className="px-6 py-2 font-medium">SKU</th>
                      <th className="px-4 py-2 font-medium">Tier</th>
                      <th className="px-4 py-2 font-medium text-right">Qty</th>
                      <th className="px-4 py-2 font-medium text-right">FCL 40GP</th>
                      <th className="px-4 py-2 font-medium text-right">FCL 40HQ</th>
                      <th className="px-4 py-2 font-medium text-right">40HQ Frac</th>
                      <th className="px-4 py-2 font-medium">Hint</th>
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
                        <td className="px-4 py-2 text-right font-mono text-[var(--c-text-secondary)]">
                          {s.fclQty40GP != null ? fmtInt(s.fclQty40GP) : "—"}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-[var(--c-text-secondary)]">
                          {s.fclQty40HQ != null ? fmtInt(s.fclQty40HQ) : "—"}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">
                          {s.fraction40HQ != null ? fmtNum(s.fraction40HQ, 2) : "—"}
                        </td>
                        <td className="px-4 py-2 text-xs text-[var(--c-text-secondary)]">{hintLabel(s.hint)}</td>
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
