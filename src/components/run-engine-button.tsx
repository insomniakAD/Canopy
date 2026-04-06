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
    totalOrderCbm: number;
  };
  error?: string;
}

export function RunEngineButton() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const router = useRouter();

  const handleRun = async () => {
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
    <div>
      <button
        onClick={handleRun}
        disabled={running}
        className="px-5 py-2.5 bg-[var(--c-accent)] text-white text-sm font-medium rounded-lg hover:bg-[var(--c-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {running ? "Running Engine\u2026" : "Run Recommendations"}
      </button>

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
              Total: {result.summary.totalOrderUnits.toLocaleString()} units / {result.summary.totalOrderCbm.toFixed(1)} CBM.
            </p>
          ) : (
            <p>{result.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
