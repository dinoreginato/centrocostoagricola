
CREATE OR REPLACE FUNCTION delete_invoice_force(target_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Force delete items first
  DELETE FROM invoice_items WHERE invoice_id = target_invoice_id;

  -- Then delete the invoice
  DELETE FROM invoices WHERE id = target_invoice_id;
END;
$$;
