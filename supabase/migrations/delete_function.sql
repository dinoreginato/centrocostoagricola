
-- 1. Create a secure function to delete ALL invoices for a set of companies
-- This function bypasses RLS because it's defined with SECURITY DEFINER
CREATE OR REPLACE FUNCTION delete_all_invoices_for_companies(company_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delete all invoices linked to the provided company IDs
  -- Cascading delete should handle invoice_items automatically if configured,
  -- but let's be explicit just in case to ensure clean removal.
  
  -- First delete items to be safe (if no cascade)
  DELETE FROM invoice_items
  WHERE invoice_id IN (
    SELECT id FROM invoices WHERE company_id = ANY(company_ids)
  );

  -- Then delete the invoices
  DELETE FROM invoices
  WHERE company_id = ANY(company_ids);
END;
$$;
