// ============================================================================
// Import Pipeline — Public API
// ============================================================================
// Usage in API routes:
//
//   import { runImport } from "@/lib/import";
//   const result = await runImport(db, { buffer, fileName, importType });
//
// ============================================================================

export { runImport } from "./orchestrator";
export type { ImportRequest } from "./orchestrator";
export type { ImportSummary, ImportErrorDetail } from "./types";

// Staging framework (Layer 3 — two-phase imports)
export { stageImport, commitStaged, cancelStaged } from "./staging/orchestrator";
export type { StageRequest, StageResult } from "./staging/orchestrator";
export { usesStaging } from "./staging/registry";
export type {
  DiffSummary,
  PeriodTotal,
  RowDelta,
  GateCheck,
  GateCheckResult,
  StagedPayloadEnvelope,
} from "./staging/types";
