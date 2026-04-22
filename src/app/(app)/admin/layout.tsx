import { AdminTabs } from "./admin-tabs";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--c-text-primary)] mb-1">Admin</h1>
      <p className="text-sm text-[var(--c-text-secondary)] mb-6">
        Audit loaded data and manage SKU definition uploads.
      </p>

      <AdminTabs />

      {children}
    </div>
  );
}
