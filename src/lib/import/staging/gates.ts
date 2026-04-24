// ============================================================================
// Shared Gate Checks
// ============================================================================
// Applied to every staged import regardless of type. Processor-specific gates
// are defined per-processor and merged into the result.
// ============================================================================

import type { ParseResult, GateCheckResult, GateCheck } from "./types";

const DEFAULT_ERROR_RATE_THRESHOLD = 0.1;

/**
 * Run the shared gate checks on a parse result.
 * Today: error-rate guard. Extended as we learn from real imports.
 */
export function runSharedGates<P>(
  parse: ParseResult<P>,
  options?: { errorRateThreshold?: number }
): GateCheckResult {
  const hardFails: GateCheck[] = [];
  const softFails: GateCheck[] = [];

  const threshold = options?.errorRateThreshold ?? DEFAULT_ERROR_RATE_THRESHOLD;
  const denominator = Math.max(1, parse.rowCount);
  const errorRate = parse.errors.length / denominator;

  if (errorRate > threshold && parse.errors.length > 0) {
    hardFails.push({
      code: "error_rate_exceeded",
      message:
        `${Math.round(errorRate * 100)}% of rows failed to parse ` +
        `(${parse.errors.length}/${parse.rowCount}). This usually means ` +
        `the wrong file type was selected or the file is malformed.`,
      count: parse.errors.length,
    });
  }

  return { hardFails, softFails };
}

/** Merge shared gate checks with processor-specific gate checks. */
export function mergeGates(...results: GateCheckResult[]): GateCheckResult {
  return {
    hardFails: results.flatMap((r) => r.hardFails),
    softFails: results.flatMap((r) => r.softFails),
  };
}
