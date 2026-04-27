CREATE OR REPLACE FUNCTION delete_invoice_force(target_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_ids uuid[];
  v_company_id uuid;
BEGIN
  SELECT company_id INTO v_company_id FROM invoices WHERE id = target_invoice_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;

  IF NOT public.is_admin_or_editor(v_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT array_agg(id)
  INTO v_item_ids
  FROM invoice_items
  WHERE invoice_id = target_invoice_id;

  PERFORM delete_invoice_items_with_effects(v_item_ids);

  DELETE FROM invoices WHERE id = target_invoice_id;
END;
$$;
