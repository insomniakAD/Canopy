"use client";

import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { FileUploader } from "@/components/file-uploader";

const IMPORT_STEPS = [
  {
    number: 1,
    label: "WDS Inventory",
    description: "Creates SKU master data",
    requiredTypes: [] as string[],
    completionTypes: ["wds_inventory"],
    optional: false,
  },
  {
    number: 2,
    label: "Kit Composition",
    description: "Defines Parent → Child kit relationships (optional)",
    requiredTypes: ["wds_inventory"],
    completionTypes: ["kit_composition"],
    optional: true,
  },
  {
    number: 3,
    label: "ASIN Mapping",
    description: "Links ASINs to SKUs",
    requiredTypes: ["wds_inventory"],
    completionTypes: ["asin_mapping"],
    optional: false,
  },
  {
    number: 4,
    label: "Sales & Forecast Data",
    description: "WDS Monthly Sales, Amazon Sales, Amazon Forecast, Amazon Vendor Central",
    requiredTypes: ["wds_inventory", "asin_mapping"],
    completionTypes: ["wds_monthly_sales", "amazon_sales", "amazon_forecast", "amazon_vendor_central"],
    optional: false,
  },
  {
    number: 5,
    label: "Purchase Orders & DI Orders",
    description: "Winsome POs and Amazon Direct Import orders",
    requiredTypes: ["wds_inventory"],
    completionTypes: ["purchase_orders", "di_orders"],
    optional: false,
  },
] as const;

type StepStatus = "completed" | "current" | "locked";

function getStepStatus(
  step: (typeof IMPORT_STEPS)[number],
  completedTypes: string[],
): StepStatus {
  const done = step.completionTypes.some((t) => completedTypes.includes(t));
  if (done) return "completed";

  const prereqsMet = step.requiredTypes.every((t) => completedTypes.includes(t));
  if (prereqsMet) return "current";

  return "locked";
}

function StepIndicator({ status }: { status: StepStatus }) {
  if (status === "completed") {
    return (
      <div className="w-8 h-8 rounded-full bg-[var(--c-success)] flex items-center justify-center flex-shrink-0">
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }

  if (status === "current") {
    return (
      <div className="w-8 h-8 rounded-full bg-[var(--c-accent)] flex items-center justify-center flex-shrink-0">
        <div className="w-3 h-3 rounded-full bg-white" />
      </div>
    );
  }

  return (
    <div className="w-8 h-8 rounded-full bg-[var(--c-border)] flex items-center justify-center flex-shrink-0">
      <div className="w-3 h-3 rounded-full bg-[var(--c-text-tertiary)]" />
    </div>
  );
}

function StepConnector({ status }: { status: StepStatus }) {
  return (
    <div
      className="hidden md:block flex-1 h-0.5 mx-2"
      style={{
        backgroundColor:
          status === "completed"
            ? "var(--c-success)"
            : "var(--c-border)",
      }}
    />
  );
}

const SUBTITLE: Record<StepStatus, { text: string; color: string }> = {
  completed: { text: "Completed", color: "var(--c-success)" },
  current: { text: "Ready", color: "var(--c-accent)" },
  locked: { text: "Complete previous steps first", color: "var(--c-text-tertiary)" },
};

function getSubtitle(
  status: StepStatus,
  optional: boolean,
): { text: string; color: string } {
  // Optional steps that aren't done yet show as "Optional"
  // rather than pushing the user to complete them.
  if (optional && status === "current") {
    return { text: "Optional", color: "var(--c-text-secondary)" };
  }
  return SUBTITLE[status];
}

interface ImportClientProps {
  completedTypes: string[];
}

export function ImportClient({ completedTypes }: ImportClientProps) {
  const router = useRouter();

  const stepStatuses = IMPORT_STEPS.map((step) => getStepStatus(step, completedTypes));

  return (
    <div>
      {/* Step tracker */}
      <Card className="mb-6">
        <p className="text-xs font-medium text-[var(--c-text-secondary)] uppercase tracking-wide mb-4">
          Import order
        </p>
        <div className="flex flex-col md:flex-row md:items-start gap-4 md:gap-0">
          {IMPORT_STEPS.map((step, i) => {
            const status = stepStatuses[i];
            const sub = getSubtitle(status, step.optional);
            return (
              <div key={step.number} className="flex md:flex-col items-center md:items-center flex-1 gap-3 md:gap-0">
                <div className="flex items-center w-full md:justify-center">
                  {i > 0 && (
                    <StepConnector
                      status={
                        stepStatuses[i - 1] === "completed" ||
                        IMPORT_STEPS[i - 1].optional
                          ? "completed"
                          : "locked"
                      }
                    />
                  )}
                  <StepIndicator status={status} />
                  {i < IMPORT_STEPS.length - 1 && (
                    <StepConnector
                      status={
                        status === "completed" || step.optional
                          ? "completed"
                          : "locked"
                      }
                    />
                  )}
                </div>
                <div className="md:mt-3 md:text-center min-w-0">
                  <p
                    className="text-sm font-medium"
                    style={{
                      color:
                        status === "locked"
                          ? "var(--c-text-tertiary)"
                          : "var(--c-text-primary)",
                    }}
                  >
                    {step.label}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: sub.color }}>
                    {sub.text}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Upload card */}
      <Card title="Upload File" subtitle="Select the file type, then drag and drop or browse for a file">
        <FileUploader
          completedTypes={completedTypes}
          onImportComplete={() => router.refresh()}
        />
      </Card>
    </div>
  );
}
