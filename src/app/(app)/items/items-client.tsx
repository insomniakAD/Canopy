"use client";

import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { FileUploader } from "@/components/file-uploader";

export function ItemsClient({ completedTypes }: { completedTypes: string[] }) {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <Card
        title="Download Template"
        subtitle="Excel workbook with Vendors, Items, and Kits sheets. First data row explains the expected format."
      >
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-[var(--c-text-secondary)]">
            Use this template to update SKU attributes in bulk, add or update
            vendors, and rebuild kit bills-of-materials. Blank cells are
            ignored — the importer never clears fields.
          </p>
          <a
            href="/templates/ItemUpdateTemplate.xlsx"
            download
            className="px-4 py-2 bg-[var(--c-accent)] text-white text-sm font-medium rounded-lg hover:bg-[var(--c-accent-hover)] transition-colors whitespace-nowrap"
          >
            Download .xlsx
          </a>
        </div>
      </Card>

      <Card
        title="Upload Item Update"
        subtitle="Fill out the template, then upload it here. A vendor change on a SKU queues a pending transition instead of overwriting current values."
      >
        <FileUploader
          completedTypes={completedTypes}
          onImportComplete={() => router.refresh()}
        />
      </Card>
    </div>
  );
}
