-- Rename the "Amazon 1P" inventory location to "Amazon FC".
-- The location now represents total Amazon fulfillment-center inventory
-- (1P + DI combined), not 1P-only. The new Inventory Health CSV format
-- doesn't distinguish channels at the FC level.
UPDATE "inventory_locations" SET "name" = 'Amazon FC' WHERE "name" = 'Amazon 1P';
