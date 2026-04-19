"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface RunResult {
  success: boolean;
  summary?: {
    skusProcessed: number;
    orderCount: number;
    watchCount: number;
    doNotOrderCount: number;
    totalOrderUnits: number;
    totalFractionHQ: number;
  };
  error?: string;
}

export function RunEngineButton() {
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const router = useRouter();

  const handleRun = async () => {
    setConfirming(false);
    setRunning(true);
    setResult(null);

    try {
      const res = await fetch("/api/recommendations", { method: "POST" });
      const json = await res.json();

      if (res.ok && json.success) {
        setResult({ success: true, summary: json.summary });
        router.refresh();
      } else {
        setResult({ success: false, error: json.error ?? "Engine run failed" });
      }
    } catch {
      setResult({ success: false, error: "Network error — could not reach the server." });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setConfirming(true)}
        disabled={running}
        className="px-5 py-2.5 bg-[var(--c-accent)] text-white text-sm font-medium rounded-lg hover:bg-[var(--c-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {running ? "Running Engine\u2026" : "Run Recommendations"}
      </button>

      {confirming && (
        <div className="absolute right-0 top-12 z-20 w-80 bg-[var(--c-card-bg)] border border-[var(--c-border)] rounded-xl shadow-lg px-5 py-4">
          <p className="text-sm font-semibold text-[var(--c-text-primary)] mb-1">Recalculate all recommendations?</p>
          <p className="text-xs text-[var(--c-text-secondary)] mb-4">
            This will replace your current recommendations with a fresh calculation based on the latest data.
          </p>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setConfirming(false)}
              className="px-3 py-1.5 text-sm text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)] rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleRun}
              className="px-4 py-1.5 text-sm font-medium bg-[var(--c-accent)] text-white rounded-lg hover:bg-[var(--c-accent-hover)] transition-colors"
            >
              Yes, Run Engine
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className={`mt-3 rounded-lg px-4 py-3 text-sm ${
          result.success ? "bg-[var(--c-success-bg)] text-[var(--c-success-text)]" : "bg-[var(--c-error-bg)] text-[var(--c-error-text)]"
        }`}>
          {result.success && result.summary ? (
            <p>
              Processed {result.summary.skusProcessed} SKUs —{" "}
              <strong>{result.summary.orderCount}</strong> to order,{" "}
              <strong>{result.summary.watchCount}</strong> to watch,{" "}
              <strong>{result.summary.doNotOrderCount}</strong> do not order.{" "}
              Total: {result.summary.totalOrderUnits.toLocaleString()} units / ~{result.summary.totalFractionHQ.toFixed(1)} × 40HQ.
            </p>
          ) : (
            <p>{result.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
