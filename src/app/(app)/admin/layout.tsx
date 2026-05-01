import { AdminTabs } from "./admin-tabs";
import { PageHeader } from "@/components/page-header";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PageHeader title="Admin" />
      <p className="text-sm text-[var(--c-text-secondary)] mb-6">
        Audit loaded data and manage SKU definition uploads.
      </p>

      <AdminTabs />

      {children}
    </div>
  );
}
