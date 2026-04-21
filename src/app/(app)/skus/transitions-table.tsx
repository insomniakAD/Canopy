"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";

export interface TransitionRow {
  id: string;
  createdAt: string;
  reason: string | null;
  expectedFirstPoDate: string | null;
  newVendorCode: string;
  newUnitCost: number | null;
  newMoq: number | null;
  sku: { skuCode: string; name: string };
  fromFactory: { name: string; vendorCode: string | null } | null;
  toFactory: { name: string; vendorCode: string | null } | null;
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDateInput(d: string | null) {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toISOString().slice(0, 10);
}

export function TransitionsTable({ rows }: { rows: TransitionRow[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--c-text-tertiary)] py-4">
        No pending transitions. A row appears here whenever an Item Update
        changes a SKU&apos;s VENDOR# to a different vendor.
      </p>
    );
  }

  const beginEdit = (row: TransitionRow) => {
    setEditingId(row.id);
    setReason(row.reason ?? "");
    setExpectedDate(fmtDateInput(row.expectedFirstPoDate));
    setError(null);
  };

  const saveEdit = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/transitions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reason || null,
          expectedFirstPoDate: expectedDate || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Save failed");
      } else {
        setEditingId(null);
        router.refresh();
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  };

  const cancelTransition = async (id: string, skuCode: string) => {
    if (!confirm(`Cancel the pending vendor transition for SKU ${skuCode}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/transitions/${id}/cancel`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Cancel failed");
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && (
        <div className="mb-3 bg-[var(--c-error-bg)] border border-[var(--c-error-border)] rounded-lg px-4 py-2 text-sm text-[var(--c-error-text)]">
          {error}
        </div>
      )}
      <div className="overflow-x-auto -mx-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
              <th className="px-6 py-3 font-medium">Created</th>
              <th className="px-6 py-3 font-medium">SKU</th>
              <th className="px-6 py-3 font-medium">From</th>
              <th className="px-6 py-3 font-medium">To</th>
              <th className="px-6 py-3 font-medium text-right">New Cost</th>
              <th className="px-6 py-3 font-medium text-right">New MOQ</th>
              <th className="px-6 py-3 font-medium">Expected 1st PO</th>
              <th className="px-6 py-3 font-medium">Reason</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const isEditing = editingId === t.id;
              return (
                <tr
                  key={t.id}
                  className="border-b border-[var(--c-border-row)] hover:bg-[var(--c-page-bg)] align-top"
                >
                  <td className="px-6 py-3 text-[var(--c-text-secondary)] whitespace-nowrap">
                    {fmtDate(t.createdAt)}
                  </td>
                  <td className="px-6 py-3">
                    <div className="font-mono font-medium">{t.sku.skuCode}</div>
                    <div className="text-xs text-[var(--c-text-tertiary)] truncate max-w-[200px]">
                      {t.sku.name}
                    </div>
                  </td>
                  <td className="px-6 py-3 text-[var(--c-text-secondary)]">
                    {t.fromFactory
                      ? `${t.fromFactory.vendorCode ?? "—"} · ${t.fromFactory.name}`
                      : "—"}
                  </td>
                  <td className="px-6 py-3">
                    {t.toFactory
                      ? `${t.toFactory.vendorCode ?? t.newVendorCode} · ${t.toFactory.name}`
                      : t.newVendorCode}
                  </td>
                  <td className="px-6 py-3 text-right font-mono">
                    {t.newUnitCost != null ? `$${Number(t.newUnitCost).toFixed(2)}` : "—"}
                  </td>
                  <td className="px-6 py-3 text-right font-mono">{t.newMoq ?? "—"}</td>
                  <td className="px-6 py-3">
                    {isEditing ? (
                      <input
                        type="date"
                        value={expectedDate}
                        onChange={(e) => setExpectedDate(e.target.value)}
                        className="border border-[var(--c-border)] rounded px-2 py-1 text-sm bg-[var(--c-card-bg)]"
                      />
                    ) : (
                      fmtDate(t.expectedFirstPoDate)
                    )}
                  </td>
                  <td className="px-6 py-3 max-w-[220px]">
                    {isEditing ? (
                      <input
                        type="text"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Why is this vendor changing?"
                        className="w-full border border-[var(--c-border)] rounded px-2 py-1 text-sm bg-[var(--c-card-bg)]"
                      />
                    ) : (
                      <span className="text-[var(--c-text-secondary)]">
                        {t.reason || <span className="text-[var(--c-text-tertiary)]">—</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <Badge variant="warning">pending</Badge>
                  </td>
                  <td className="px-6 py-3 text-right whitespace-nowrap">
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => saveEdit(t.id)}
                          disabled={busy}
                          className="text-sm text-[var(--c-accent)] hover:underline disabled:opacity-50 mr-3"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          disabled={busy}
                          className="text-sm text-[var(--c-text-secondary)] hover:underline disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => beginEdit(t)}
                          disabled={busy}
                          className="text-sm text-[var(--c-accent)] hover:underline disabled:opacity-50 mr-3"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => cancelTransition(t.id, t.sku.skuCode)}
                          disabled={busy}
                          className="text-sm text-[var(--c-error)] hover:underline disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
