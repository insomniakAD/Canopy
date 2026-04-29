-- CreateEnum
CREATE TYPE "BlobSyncStatus" AS ENUM ('preview', 'applied', 'cancelled', 'failed');

-- CreateTable
CREATE TABLE "blob_syncs" (
    "id" UUID NOT NULL,
    "pathname" TEXT NOT NULL,
    "pulled_at" TIMESTAMP(3) NOT NULL,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "imported_count" INTEGER NOT NULL DEFAULT 0,
    "status" "BlobSyncStatus" NOT NULL,
    "error_message" TEXT,
    "import_batch_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blob_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "blob_syncs_pathname_pulled_at_idx" ON "blob_syncs"("pathname", "pulled_at");
