CREATE OR REPLACE FUNCTION public.reverse_inventory_movement(
  target_product_id uuid,
  quantity_to_remove numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT company_id INTO v_company_id
  FROM public.products
  WHERE id = target_product_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  IF NOT public.is_admin_or_editor(v_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  UPDATE public.products
  SET current_stock = current_stock - quantity_to_remove,
      updated_at = now()
  WHERE id = target_product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_inventory_movement(uuid, numeric) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.update_inventory_with_average_cost(
  product_id uuid,
  quantity_in numeric,
  unit_cost numeric,
  invoice_item_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_stock_val numeric;
  current_avg_cost_val numeric;
  new_stock numeric;
  new_avg_cost numeric;
  v_company_id uuid;
  v_invoice_company_id uuid;
BEGIN
  SELECT company_id, current_stock, average_cost
  INTO v_company_id, current_stock_val, current_avg_cost_val
  FROM public.products
  WHERE id = product_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  IF NOT public.is_admin_or_editor(v_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT i.company_id
  INTO v_invoice_company_id
  FROM public.invoice_items ii
  JOIN public.invoices i ON ii.invoice_id = i.id
  WHERE ii.id = invoice_item_id;

  IF v_invoice_company_id IS NULL THEN
    RAISE EXCEPTION 'Ítem de factura no encontrado';
  END IF;

  IF v_invoice_company_id <> v_company_id THEN
    RAISE EXCEPTION 'Ítem no pertenece a la empresa del producto';
  END IF;

  current_stock_val := COALESCE(current_stock_val, 0);
  current_avg_cost_val := COALESCE(current_avg_cost_val, 0);

  new_stock := current_stock_val + quantity_in;
  new_avg_cost := CASE
    WHEN new_stock > 0 THEN ((current_stock_val * current_avg_cost_val) + (quantity_in * unit_cost)) / new_stock
    ELSE 0
  END;

  UPDATE public.products
  SET current_stock = new_stock,
      average_cost = new_avg_cost,
      updated_at = now()
  WHERE id = product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_inventory_with_average_cost(uuid, numeric, numeric, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_general_costs_summary(p_company_id uuid)
RETURNS TABLE (invoice_item_id uuid, total_assigned numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN QUERY
  SELECT gc.invoice_item_id, COALESCE(SUM(gc.amount), 0)
  FROM public.general_costs gc
  WHERE gc.company_id = p_company_id
    AND gc.invoice_item_id IS NOT NULL
  GROUP BY gc.invoice_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_general_costs_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_general_costs_summary(uuid) TO authenticated;

