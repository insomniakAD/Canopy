"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Card } from "@/components/ui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TierRule {
  id: string;
  tier: string;
  targetDaysOfSupply: number;
  description: string | null;
}

interface SafetyRule {
  id: string;
  tier: string;
  safetyStockDays: number;
  description: string | null;
}

interface LeadTimeRule {
  id: string;
  country: string;
  poToProductionDays: number;
  productionDays: number;
  transitDays: number;
  portProcessingDays: number;
  totalLeadTimeDays: number;
}

interface ContainerRule {
  id: string;
  containerType: string;
  maxCbm: number;
  maxWeightKg: number;
  costEstimateUsd: number | null;
}

interface SeasonalityEntry {
  id: string;
  month: number;
  monthName: string;
  factor: number;
}

interface Props {
  tierRules: TierRule[];
  safetyRules: SafetyRule[];
  leadTimeRules: LeadTimeRule[];
  containerRules: ContainerRule[];
  seasonality: SeasonalityEntry[];
}

// ---------------------------------------------------------------------------
// Inline-edit cell types
// ---------------------------------------------------------------------------

type EditingCell = {
  table: string;
  id: string;
  field: string;
} | null;

type SaveStatus = {
  table: string;
  id: string;
  field: string;
  status: "saved" | "error";
  message?: string;
} | null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function containerLabel(t: string) {
  return t === "forty_hq" ? "40HQ" : t === "forty_gp" ? "40GP" : t;
}

/** Shared inline-input styles — compact, same height as table text. */
const inputClass =
  "w-20 h-7 px-1.5 text-sm font-mono text-right bg-transparent border border-[var(--c-accent)] rounded outline-none focus:ring-1 focus:ring-[var(--c-accent)] text-[var(--c-text-primary)]";

const btnClass =
  "inline-flex items-center justify-center w-6 h-6 rounded text-xs leading-none cursor-pointer transition-colors";

// ---------------------------------------------------------------------------
// EditableCell — reusable component for each editable numeric value
// ---------------------------------------------------------------------------

function EditableCell({
  table,
  id,
  field,
  value,
  display,
  editing,
  saveStatus,
  onStartEdit,
  onSave,
  onCancel,
}: {
  table: string;
  id: string;
  field: string;
  value: number;
  display?: string;
  editing: boolean;
  saveStatus: SaveStatus;
  onStartEdit: (table: string, id: string, field: string) => void;
  onSave: (table: string, id: string, field: string, newValue: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(String(value));

  // When entering edit mode, reset draft and focus the input
  useEffect(() => {
    if (editing) {
      setDraft(String(value));
      // Small delay so the input is mounted before focus
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing, value]);

  const matchesCell =
    saveStatus !== null &&
    saveStatus.table === table &&
    saveStatus.id === id &&
    saveStatus.field === field;

  const cellStatus = matchesCell ? saveStatus : null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      onSave(table, id, field, draft);
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          className={inputClass}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className={`${btnClass} bg-[var(--c-success-bg)] text-[var(--c-success-text)] hover:bg-[var(--c-success)]  hover:text-white`}
          onClick={() => onSave(table, id, field, draft)}
          title="Save"
          aria-label="Save"
        >
          &#10003;
        </button>
        <button
          type="button"
          className={`${btnClass} bg-[var(--c-error-bg)] text-[var(--c-error-text)] hover:bg-[var(--c-error)] hover:text-white`}
          onClick={onCancel}
          title="Cancel"
          aria-label="Cancel"
        >
          &#10005;
        </button>
      </span>
    );
  }

  return (
    <span className="group relative">
      <button
        type="button"
        className="font-mono cursor-pointer rounded px-1 -mx-1 hover:bg-[var(--c-info-bg)] hover:text-[var(--c-accent)] transition-colors"
        onClick={() => onStartEdit(table, id, field)}
        title="Click to edit"
      >
        {display ?? value}
      </button>
      {cellStatus && cellStatus.status === "saved" && (
        <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-[var(--c-success)] whitespace-nowrap">
          Saved
        </span>
      )}
      {cellStatus && cellStatus.status === "error" && (
        <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-[var(--c-error)] whitespace-nowrap">
          {cellStatus.message ?? "Error"}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SettingsEditor({
  tierRules: initialTierRules,
  safetyRules: initialSafetyRules,
  leadTimeRules: initialLeadTimeRules,
  containerRules: initialContainerRules,
  seasonality: initialSeasonality,
}: Props) {
  // Mutable state so edits reflect immediately
  const [tierRules, setTierRules] = useState(initialTierRules);
  const [safetyRules, setSafetyRules] = useState(initialSafetyRules);
  const [leadTimeRules, setLeadTimeRules] = useState(initialLeadTimeRules);
  const [containerRules, setContainerRules] = useState(initialContainerRules);
  const [seasonality, setSeasonality] = useState(initialSeasonality);

  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(null);

  // Clear the "Saved" / error indicator after a short delay
  useEffect(() => {
    if (!saveStatus) return;
    const t = setTimeout(() => setSaveStatus(null), 2000);
    return () => clearTimeout(t);
  }, [saveStatus]);

  const onStartEdit = useCallback((table: string, id: string, field: string) => {
    setEditingCell({ table, id, field });
    setSaveStatus(null);
  }, []);

  const onCancel = useCallback(() => {
    setEditingCell(null);
  }, []);

  const onSave = useCallback(
    async (table: string, id: string, field: string, rawValue: string) => {
      const numValue = Number(rawValue);
      if (isNaN(numValue) || numValue < 0) {
        setSaveStatus({ table, id, field, status: "error", message: "Invalid number" });
        return;
      }

      setEditingCell(null);

      try {
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ table, id, field, value: numValue }),
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
          setSaveStatus({ table, id, field, status: "error", message: data.error ?? "Save failed" });
          return;
        }

        // Update local state so the new value renders immediately
        switch (table) {
          case "sku_tier_rules":
            setTierRules((prev) =>
              prev.map((r) => (r.id === id ? { ...r, [field]: Math.round(numValue) } : r))
            );
            break;
          case "safety_stock_rules":
            setSafetyRules((prev) =>
              prev.map((r) => (r.id === id ? { ...r, [field]: Math.round(numValue) } : r))
            );
            break;
          case "lead_time_rules":
            setLeadTimeRules((prev) =>
              prev.map((r) => {
                if (r.id !== id) return r;
                const updated = { ...r, [field]: Math.round(numValue) };
                // Use server-computed total if provided
                if (data.totalLeadTimeDays != null) {
                  updated.totalLeadTimeDays = data.totalLeadTimeDays;
                }
                return updated;
              })
            );
            break;
          case "container_rules":
            setContainerRules((prev) =>
              prev.map((r) => (r.id === id ? { ...r, [field]: numValue } : r))
            );
            break;
          case "seasonality_factors":
            setSeasonality((prev) =>
              prev.map((s) => (s.id === id ? { ...s, [field]: numValue } : s))
            );
            break;
        }

        setSaveStatus({ table, id, field, status: "saved" });
      } catch {
        setSaveStatus({ table, id, field, status: "error", message: "Network error" });
      }
    },
    []
  );

  /** Shorthand: is this specific cell being edited right now? */
  const isEditing = (table: string, id: string, field: string) =>
    editingCell?.table === table && editingCell?.id === id && editingCell?.field === field;

  // Shared props for every EditableCell
  const cellProps = { editing: false, saveStatus, onStartEdit, onSave, onCancel };

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------- */}
      {/* Tier targeting rules                                             */}
      {/* ---------------------------------------------------------------- */}
      <Card title="SKU Tier Rules" subtitle="How many days of supply to target for each tier">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
              <th className="py-2 font-medium">Tier</th>
              <th className="py-2 font-medium text-right">Target Days of Supply</th>
              <th className="py-2 font-medium text-right">Target Weeks</th>
              <th className="py-2 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {tierRules.map((r) => (
              <tr key={r.id} className="border-b border-[var(--c-border-row)]">
                <td className="py-3 font-semibold">Tier {r.tier}</td>
                <td className="py-3 text-right">
                  <EditableCell
                    {...cellProps}
                    table="sku_tier_rules"
                    id={r.id}
                    field="targetDaysOfSupply"
                    value={r.targetDaysOfSupply}
                    editing={isEditing("sku_tier_rules", r.id, "targetDaysOfSupply")}
                  />
                </td>
                <td className="py-3 text-right font-mono text-[var(--c-text-secondary)]">
                  {(r.targetDaysOfSupply / 7).toFixed(1)}
                </td>
                <td className="py-3 text-[var(--c-text-secondary)]">{r.description ?? "\u2014"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Safety stock rules                                               */}
      {/* ---------------------------------------------------------------- */}
      <Card title="Safety Stock Rules" subtitle="Extra buffer stock days by tier to prevent stockouts">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
              <th className="py-2 font-medium">Tier</th>
              <th className="py-2 font-medium text-right">Safety Stock Days</th>
              <th className="py-2 font-medium text-right">Safety Weeks</th>
              <th className="py-2 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {safetyRules.map((r) => (
              <tr key={r.id} className="border-b border-[var(--c-border-row)]">
                <td className="py-3 font-semibold">Tier {r.tier}</td>
                <td className="py-3 text-right">
                  <EditableCell
                    {...cellProps}
                    table="safety_stock_rules"
                    id={r.id}
                    field="safetyStockDays"
                    value={r.safetyStockDays}
                    editing={isEditing("safety_stock_rules", r.id, "safetyStockDays")}
                  />
                </td>
                <td className="py-3 text-right font-mono text-[var(--c-text-secondary)]">
                  {(r.safetyStockDays / 7).toFixed(1)}
                </td>
                <td className="py-3 text-[var(--c-text-secondary)]">{r.description ?? "\u2014"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Lead time rules                                                  */}
      {/* ---------------------------------------------------------------- */}
      <Card title="Lead Time Rules" subtitle="Default lead time breakdown by source country (in days)">
        <div className="overflow-x-auto -mx-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                <th className="px-6 py-2 font-medium">Country</th>
                <th className="px-4 py-2 font-medium text-right">PO to Production</th>
                <th className="px-4 py-2 font-medium text-right">Production</th>
                <th className="px-4 py-2 font-medium text-right">Transit</th>
                <th className="px-4 py-2 font-medium text-right">Port Processing</th>
                <th className="px-4 py-2 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {leadTimeRules.map((r) => (
                <tr key={r.id} className="border-b border-[var(--c-border-row)]">
                  <td className="px-6 py-3 font-semibold capitalize">{r.country}</td>
                  <td className="px-4 py-3 text-right">
                    <EditableCell
                      {...cellProps}
                      table="lead_time_rules"
                      id={r.id}
                      field="poToProductionDays"
                      value={r.poToProductionDays}
                      editing={isEditing("lead_time_rules", r.id, "poToProductionDays")}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <EditableCell
                      {...cellProps}
                      table="lead_time_rules"
                      id={r.id}
                      field="productionDays"
                      value={r.productionDays}
                      editing={isEditing("lead_time_rules", r.id, "productionDays")}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <EditableCell
                      {...cellProps}
                      table="lead_time_rules"
                      id={r.id}
                      field="transitDays"
                      value={r.transitDays}
                      editing={isEditing("lead_time_rules", r.id, "transitDays")}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <EditableCell
                      {...cellProps}
                      table="lead_time_rules"
                      id={r.id}
                      field="portProcessingDays"
                      value={r.portProcessingDays}
                      editing={isEditing("lead_time_rules", r.id, "portProcessingDays")}
                    />
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">{r.totalLeadTimeDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Container rules                                                  */}
      {/* ---------------------------------------------------------------- */}
      <Card title="Container Rules" subtitle="Capacity and cost estimates for each container type">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
              <th className="py-2 font-medium">Container</th>
              <th className="py-2 font-medium text-right">Max CBM</th>
              <th className="py-2 font-medium text-right">Max Weight (kg)</th>
              <th className="py-2 font-medium text-right">Est. Shipping Cost</th>
            </tr>
          </thead>
          <tbody>
            {containerRules.map((r) => (
              <tr key={r.id} className="border-b border-[var(--c-border-row)]">
                <td className="py-3 font-semibold">{containerLabel(r.containerType)}</td>
                <td className="py-3 text-right">
                  <EditableCell
                    {...cellProps}
                    table="container_rules"
                    id={r.id}
                    field="maxCbm"
                    value={r.maxCbm}
                    editing={isEditing("container_rules", r.id, "maxCbm")}
                  />
                </td>
                <td className="py-3 text-right">
                  <EditableCell
                    {...cellProps}
                    table="container_rules"
                    id={r.id}
                    field="maxWeightKg"
                    value={r.maxWeightKg}
                    display={r.maxWeightKg.toLocaleString()}
                    editing={isEditing("container_rules", r.id, "maxWeightKg")}
                  />
                </td>
                <td className="py-3 text-right">
                  {r.costEstimateUsd != null ? (
                    <EditableCell
                      {...cellProps}
                      table="container_rules"
                      id={r.id}
                      field="costEstimateUsd"
                      value={r.costEstimateUsd}
                      display={`$${r.costEstimateUsd.toLocaleString()}`}
                      editing={isEditing("container_rules", r.id, "costEstimateUsd")}
                    />
                  ) : (
                    "\u2014"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Seasonality factors                                              */}
      {/* ---------------------------------------------------------------- */}
      <Card title="Seasonality Factors" subtitle="Monthly multipliers applied to demand velocity. 1.0 = no adjustment.">
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {seasonality.map((s) => {
            const editing = isEditing("seasonality_factors", s.id, "factor");
            return (
              <div
                key={s.id}
                className={`rounded-lg border px-4 py-3 text-center ${
                  editing
                    ? "border-[var(--c-accent)] bg-[var(--c-info-bg-light)] ring-1 ring-[var(--c-accent)]"
                    : s.factor !== 1
                      ? "border-[var(--c-accent)] bg-[var(--c-info-bg-light)]"
                      : "border-[var(--c-border)] bg-[var(--c-page-bg)]"
                }`}
              >
                <p className="text-xs text-[var(--c-text-secondary)] font-medium">{s.monthName}</p>
                <div className="mt-0.5">
                  {editing ? (
                    <SeasonalityInput
                      id={s.id}
                      value={s.factor}
                      onSave={onSave}
                      onCancel={onCancel}
                    />
                  ) : (
                    <span className="relative inline-block">
                      <button
                        type="button"
                        className={`text-lg font-bold cursor-pointer rounded px-1 -mx-1 hover:bg-[var(--c-info-bg)] transition-colors ${
                          s.factor > 1
                            ? "text-[var(--c-success)]"
                            : s.factor < 1
                              ? "text-[var(--c-error)]"
                              : "text-[var(--c-text-primary)]"
                        }`}
                        onClick={() => onStartEdit("seasonality_factors", s.id, "factor")}
                        title="Click to edit"
                      >
                        {s.factor.toFixed(2)}
                      </button>
                      {saveStatus &&
                        saveStatus.table === "seasonality_factors" &&
                        saveStatus.id === s.id &&
                        saveStatus.field === "factor" && (
                          <span
                            className={`absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] font-semibold whitespace-nowrap ${
                              saveStatus.status === "saved"
                                ? "text-[var(--c-success)]"
                                : "text-[var(--c-error)]"
                            }`}
                          >
                            {saveStatus.status === "saved" ? "Saved" : saveStatus.message ?? "Error"}
                          </span>
                        )}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-[var(--c-text-tertiary)] mt-3">
          Factors above 1.0 increase the demand signal (e.g. holiday season). Below 1.0 reduces it.
        </p>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Footer note                                                      */}
      {/* ---------------------------------------------------------------- */}
      <div className="bg-[var(--c-page-bg)] border border-[var(--c-border)] rounded-xl px-6 py-4">
        <p className="text-sm text-[var(--c-text-secondary)]">
          <strong className="text-[var(--c-text-body)]">How to update settings:</strong>{" "}
          Click any value to edit. Changes take effect on the next recommendation run.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SeasonalityInput — special compact input for the grid cards
// ---------------------------------------------------------------------------

function SeasonalityInput({
  id,
  value,
  onSave,
  onCancel,
}: {
  id: string;
  value: number;
  onSave: (table: string, id: string, field: string, newValue: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value.toFixed(2));

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.select());
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      onSave("seasonality_factors", id, "factor", draft);
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        className="w-16 h-7 px-1 text-center text-lg font-bold bg-transparent border border-[var(--c-accent)] rounded outline-none focus:ring-1 focus:ring-[var(--c-accent)] text-[var(--c-text-primary)]"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span className="flex gap-1">
        <button
          type="button"
          className={`${btnClass} bg-[var(--c-success-bg)] text-[var(--c-success-text)] hover:bg-[var(--c-success)] hover:text-white`}
          onClick={() => onSave("seasonality_factors", id, "factor", draft)}
          title="Save"
          aria-label="Save"
        >
          &#10003;
        </button>
        <button
          type="button"
          className={`${btnClass} bg-[var(--c-error-bg)] text-[var(--c-error-text)] hover:bg-[var(--c-error)] hover:text-white`}
          onClick={onCancel}
          title="Cancel"
          aria-label="Cancel"
        >
          &#10005;
        </button>
      </span>
    </div>
  );
}
