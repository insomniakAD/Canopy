import { db } from "@/lib/db";
import { Card } from "@/components/ui";
import { UploadsClient } from "./uploads-client";

async function loadCompletedTypes(): Promise<string[]> {
  try {
    const completed = await db.importBatch.findMany({
      where: { status: "completed" },
      select: { importType: true },
      distinct: ["importType"],
    });
    return completed.map((b) => b.importType);
  } catch {
    return [];
  }
}

export default async function AdminUploadsPage() {
  const completedTypes = await loadCompletedTypes();

  return (
    <div>
      <UploadsClient completedTypes={completedTypes} />

      <Card title="About These Files" className="mt-6">
        <div className="space-y-4 text-sm">
          <div>
            <p className="font-medium text-[var(--c-text-primary)] mb-1">Item Update</p>
            <p className="text-[var(--c-text-secondary)]">
              Bulk-update SKU attributes (vendor, FCL, MOQ, unit cost, ASIN, kit parent flag, tier override).
              Includes Vendors, Items, and Kits sheets.{" "}
              <a
                href="/templates/ItemUpdateTemplate.xlsx"
                download
                className="text-[var(--c-accent)] hover:underline font-medium"
              >
                Download template →
              </a>
            </p>
          </div>
          <div>
            <p className="font-medium text-[var(--c-text-primary)] mb-1">Kit Composition</p>
            <p className="text-[var(--c-text-secondary)]">
              Defines Parent → Child kit relationships and quantity-per-kit. Use this when a Parent SKU&apos;s
              children change, or to onboard new kits not covered by Item Update.
            </p>
          </div>
          <div>
            <p className="font-medium text-[var(--c-text-primary)] mb-1">ASIN Mapping</p>
            <p className="text-[var(--c-text-secondary)]">
              Links Amazon ASINs to Winsome SKU codes. Required for Amazon Sales Diagnostic, Vendor Central,
              and Forecasting imports to match rows to SKUs.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
