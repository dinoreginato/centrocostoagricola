
-- Update foreign key for invoice_items to allow cascade delete
ALTER TABLE "public"."invoice_items" DROP CONSTRAINT "invoice_items_invoice_id_fkey";
ALTER TABLE "public"."invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" 
  FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;
