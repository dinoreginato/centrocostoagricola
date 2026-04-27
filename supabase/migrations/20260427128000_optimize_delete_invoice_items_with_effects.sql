CREATE OR REPLACE FUNCTION public.delete_invoice_items_with_effects(
  p_invoice_item_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_company_count int;
  v_bad_products int;
BEGIN
  IF p_invoice_item_ids IS NULL OR array_length(p_invoice_item_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(DISTINCT i.company_id), MAX(i.company_id)
  INTO v_company_count, v_company_id
  FROM public.invoice_items ii
  JOIN public.invoices i ON ii.invoice_id = i.id
  WHERE ii.id = ANY(p_invoice_item_ids);

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Ítem no encontrado';
  END IF;

  IF v_company_count <> 1 THEN
    RAISE EXCEPTION 'Ítems pertenecen a distintas compañías';
  END IF;

  IF NOT public.is_admin_or_editor(v_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT COUNT(*)
  INTO v_bad_products
  FROM public.invoice_items ii
  LEFT JOIN public.products p ON p.id = ii.product_id
  WHERE ii.id = ANY(p_invoice_item_ids)
    AND ii.product_id IS NOT NULL
    AND (p.id IS NULL OR p.company_id <> v_company_id);

  IF COALESCE(v_bad_products, 0) > 0 THEN
    RAISE EXCEPTION 'Producto no pertenece a la compañía de la factura';
  END IF;

  UPDATE public.products p
  SET current_stock = p.current_stock - x.qty,
      updated_at = now()
  FROM (
    SELECT ii.product_id, COALESCE(SUM(ii.quantity), 0) AS qty
    FROM public.invoice_items ii
    WHERE ii.id = ANY(p_invoice_item_ids)
      AND ii.product_id IS NOT NULL
    GROUP BY ii.product_id
  ) x
  WHERE p.id = x.product_id;

  DELETE FROM public.fuel_assignments fa WHERE fa.invoice_item_id = ANY(p_invoice_item_ids);
  DELETE FROM public.irrigation_assignments ia WHERE ia.invoice_item_id = ANY(p_invoice_item_ids);
  DELETE FROM public.machinery_assignments ma WHERE ma.invoice_item_id = ANY(p_invoice_item_ids);
  DELETE FROM public.labor_assignments la WHERE la.invoice_item_id = ANY(p_invoice_item_ids);
  DELETE FROM public.general_costs gc WHERE gc.invoice_item_id = ANY(p_invoice_item_ids);

  DELETE FROM public.invoice_items ii WHERE ii.id = ANY(p_invoice_item_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_invoice_items_with_effects(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_invoice_items_with_effects(uuid[]) TO authenticated;

