"use client";

import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { FileUploader } from "@/components/file-uploader";

const ADMIN_IMPORT_TYPES = [
  { value: "item_update", label: "Item Update", requires: ["wds_inventory"] },
  { value: "kit_composition", label: "Kit Composition", requires: ["wds_inventory"] },
  { value: "asin_mapping", label: "ASIN Mapping", requires: ["wds_inventory"] },
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
