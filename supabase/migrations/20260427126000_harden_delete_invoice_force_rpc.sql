CREATE OR REPLACE FUNCTION public.delete_invoice_force(target_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_ids uuid[];
  v_company_id uuid;
BEGIN
  SELECT i.company_id INTO v_company_id
  FROM public.invoices i
  WHERE i.id = target_invoice_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;

  IF NOT public.is_admin_or_editor(v_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT array_agg(ii.id)
  INTO v_item_ids
  FROM public.invoice_items ii
  WHERE ii.invoice_id = target_invoice_id;

  IF v_item_ids IS NOT NULL AND array_length(v_item_ids, 1) IS NOT NULL THEN
    PERFORM public.delete_invoice_items_with_effects(v_item_ids);
  END IF;

  DELETE FROM public.invoices i WHERE i.id = target_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_invoice_force(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_invoice_force(uuid) TO authenticated;

