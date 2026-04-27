CREATE OR REPLACE FUNCTION public.delete_application_and_restore_stock(target_application_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT f.company_id
  INTO v_company_id
  FROM public.applications a
  JOIN public.fields f ON a.field_id = f.id
  WHERE a.id = target_application_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Aplicación no encontrada';
  END IF;

  IF NOT public.is_admin_or_editor(v_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  UPDATE public.products p
  SET current_stock = p.current_stock + x.qty,
      updated_at = now()
  FROM (
    SELECT product_id, COALESCE(SUM(quantity_used), 0) AS qty
    FROM public.application_items
    WHERE application_id = target_application_id
    GROUP BY product_id
  ) x
  WHERE p.id = x.product_id;

  DELETE FROM public.inventory_movements im
  WHERE im.application_item_id IN (
    SELECT ai.id
    FROM public.application_items ai
    WHERE ai.application_id = target_application_id
  );

  DELETE FROM public.applications a
  WHERE a.id = target_application_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_application_and_restore_stock(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_application_and_restore_stock(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.delete_all_applications_restore_stock(target_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = target_company_id) THEN
    RAISE EXCEPTION 'Empresa no encontrada';
  END IF;

  IF NOT public.is_admin_or_editor(target_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  WITH apps AS (
    SELECT a.id
    FROM public.applications a
    JOIN public.fields f ON a.field_id = f.id
    WHERE f.company_id = target_company_id
  ),
  sums AS (
    SELECT ai.product_id, COALESCE(SUM(ai.quantity_used), 0) AS qty
    FROM public.application_items ai
    JOIN apps ON ai.application_id = apps.id
    GROUP BY ai.product_id
  )
  UPDATE public.products p
  SET current_stock = p.current_stock + sums.qty,
      updated_at = now()
  FROM sums
  WHERE p.id = sums.product_id;

  DELETE FROM public.inventory_movements im
  WHERE im.application_item_id IN (
    SELECT ai.id
    FROM public.application_items ai
    JOIN public.applications a ON ai.application_id = a.id
    JOIN public.fields f ON a.field_id = f.id
    WHERE f.company_id = target_company_id
  );

  DELETE FROM public.applications a
  WHERE a.id IN (
    SELECT a2.id
    FROM public.applications a2
    JOIN public.fields f2 ON a2.field_id = f2.id
    WHERE f2.company_id = target_company_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_all_applications_restore_stock(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_all_applications_restore_stock(uuid) TO authenticated;

