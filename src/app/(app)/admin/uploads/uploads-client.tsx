"use client";

import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { FileUploader } from "@/components/file-uploader";

const ADMIN_IMPORT_TYPES = [
  { value: "wds_active_items", label: "WDS Active Items", requires: [] },
  { value: "kit_composition",  label: "Kit Composition",  requires: ["wds_active_items"] },
  { value: "asin_mapping",     label: "ASIN Mapping",     requires: ["wds_active_items"] },
  { value: "item_update",      label: "Item Update",      requires: ["wds_active_items"] },
] as const;

export function UploadsClient({ completedTypes }: { completedTypes: string[] }) {
  const router = useRouter();
  return (
    <Card title="Upload File" subtitle="Select a definition file type, then drag and drop or browse">
      <FileUploader
        completedTypes={completedTypes}
        importTypes={ADMIN_IMPORT_TYPES}
        onImportComplete={() => router.refresh()}
      />
    </Card>
  );
}
