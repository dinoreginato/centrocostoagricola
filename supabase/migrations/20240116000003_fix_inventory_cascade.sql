
-- Update foreign key for inventory_movements to allow cascade delete from invoice_items
ALTER TABLE "public"."inventory_movements" DROP CONSTRAINT "inventory_movements_invoice_item_id_fkey";
ALTER TABLE "public"."inventory_movements" ADD CONSTRAINT "inventory_movements_invoice_item_id_fkey" 
  FOREIGN KEY ("invoice_item_id") REFERENCES "public"."invoice_items"("id") ON DELETE CASCADE;
