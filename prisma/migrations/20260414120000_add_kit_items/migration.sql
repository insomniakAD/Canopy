-- AlterEnum
ALTER TYPE "ImportType" ADD VALUE 'kit_composition';

-- AlterTable
ALTER TABLE "skus" ADD COLUMN     "is_kit_component" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_kit_parent" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "kit_components" (
    "id" UUID NOT NULL,
    "parent_sku_id" UUID NOT NULL,
    "child_sku_id" UUID NOT NULL,
    "quantity_per_kit" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kit_components_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kit_components_parent_sku_id_idx" ON "kit_components"("parent_sku_id");

-- CreateIndex
CREATE INDEX "kit_components_child_sku_id_idx" ON "kit_components"("child_sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "kit_components_parent_sku_id_child_sku_id_key" ON "kit_components"("parent_sku_id", "child_sku_id");

-- AddForeignKey
ALTER TABLE "kit_components" ADD CONSTRAINT "kit_components_parent_sku_id_fkey" FOREIGN KEY ("parent_sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit_components" ADD CONSTRAINT "kit_components_child_sku_id_fkey" FOREIGN KEY ("child_sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
