CREATE OR REPLACE FUNCTION delete_invoice_force(target_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item_ids uuid[];
BEGIN
  SELECT array_agg(id)
  INTO v_item_ids
  FROM invoice_items
  WHERE invoice_id = target_invoice_id;

  PERFORM delete_invoice_items_with_effects(v_item_ids);

  DELETE FROM invoices WHERE id = target_invoice_id;
END;
$$;

