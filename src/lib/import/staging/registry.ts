// ============================================================================
// Processor Registry
// ============================================================================
// Maps ImportType → staging contract. Types in this map use the two-phase
// (stage → commit) flow. Types NOT in this map fall through to the legacy
// direct-commit path in the API route.
//
// We migrate processors into this map incrementally across Commits 2a/2b
// so the cutover is reviewable one importer at a time.
// ============================================================================

import type { ImportType } from "@/generated/prisma/client";
import type { ProcessorStagingContract } from "./types";
import { wdsMonthlySalesStaging } from "../processors/wds-monthly-sales-staging";

/**
 * Registered processors. Only import types listed here go through staging.
 * Commit 2b will add the remaining 9 processors.
 */
export const STAGING_PROCESSORS: Partial<
  Record<ImportType, ProcessorStagingContract<unknown>>
> = {
  wds_monthly_sales: wdsMonthlySalesStaging as ProcessorStagingContract<unknown>,
};

/** Returns true if this import type uses the two-phase flow. */
export function usesStaging(importType: ImportType): boolean {
  return importType in STAGING_PROCESSORS;
}

/** Fetch the contract for an import type. Throws if not registered. */
export function getProcessor(importType: ImportType): ProcessorStagingContract<unknown> {
  const contract = STAGING_PROCESSORS[importType];
  if (!contract) {
    throw new Error(
      `Import type "${importType}" is not wired for staging yet. ` +
        `Use the legacy direct-commit path or register a staging contract.`
    );
  }
  return contract;
}
