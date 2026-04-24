-- CreateEnum
CREATE TYPE "StagingStatus" AS ENUM ('staged', 'committed', 'cancelled');

-- AlterTable: add two-phase staging fields to import_batches.
-- Existing batches will have NULL staging_status (legacy direct-commit).
ALTER TABLE "import_batches" ADD COLUMN "diff_summary" JSONB,
ADD COLUMN "staged_payload" JSONB,
ADD COLUMN "staging_status" "StagingStatus";
