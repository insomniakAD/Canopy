"use client";

import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { FileUploader } from "@/components/file-uploader";

export function ImportClient() {
  const router = useRouter();

  return (
    <Card title="Upload File" subtitle="Select the file type, then drag and drop or browse for a file">
      <FileUploader onImportComplete={() => router.refresh()} />
    </Card>
  );
}
