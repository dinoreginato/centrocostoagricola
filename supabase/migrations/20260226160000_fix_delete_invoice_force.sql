
CREATE OR REPLACE FUNCTION delete_invoice_force(target_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. Delete associated machinery assignments
  DELETE FROM machinery_assignments 
  WHERE invoice_item_id IN (
      SELECT id FROM invoice_items WHERE invoice_id = target_invoice_id
  );

  -- 2. Delete associated general costs distributions
  -- (Check if table exists first to be safe, though it should exist now)
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'general_costs') THEN
      DELETE FROM general_costs 
      WHERE invoice_item_id IN (
          SELECT id FROM invoice_items WHERE invoice_id = target_invoice_id
      );
  END IF;

  -- 3. Delete invoice items
  DELETE FROM invoice_items WHERE invoice_id = target_invoice_id;

  -- 4. Delete the invoice itself
  DELETE FROM invoices WHERE id = target_invoice_id;
END;
$$;
