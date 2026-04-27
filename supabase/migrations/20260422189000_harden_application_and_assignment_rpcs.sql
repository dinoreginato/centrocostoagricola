CREATE OR REPLACE FUNCTION public.get_company_applications_v2(p_company_id uuid)
RETURNS TABLE (
  id uuid,
  application_date date,
  application_type text,
  total_cost numeric,
  water_liters_per_hectare numeric,
  field_id uuid,
  field_name text,
  sector_id uuid,
  sector_name text,
  sector_hectares numeric,
  items json
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN QUERY
  SELECT 
    a.id,
    a.application_date,
    a.application_type::text,
    COALESCE(a.total_cost, 0)::numeric,
    COALESCE(a.water_liters_per_hectare, 0)::numeric,
    f.id as field_id,
    COALESCE(f.name, 'Campo Eliminado')::text as field_name,
    s.id as sector_id,
    COALESCE(s.name, 'Sector Eliminado')::text as sector_name,
    COALESCE(s.hectares, 0)::numeric as sector_hectares,
    COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'product_id', ai.product_id,
            'product_name', p.name,
            'quantity_used', ai.quantity_used,
            'dose_per_hectare', ai.dose_per_hectare,
            'unit', p.unit,
            'unit_cost', ai.unit_cost,
            'total_cost', ai.total_cost
          )
        )
        FROM public.application_items ai
        LEFT JOIN public.products p ON ai.product_id = p.id
        WHERE ai.application_id = a.id
      ),
      '[]'::json
    ) as items
  FROM public.applications a
  LEFT JOIN public.fields f ON a.field_id = f.id
  LEFT JOIN public.sectors s ON a.sector_id = s.id
  WHERE f.company_id = p_company_id
  ORDER BY a.application_date DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_applications_v2(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_applications_v2(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_application_and_restore_stock(target_application_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item RECORD;
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

  FOR item IN
    SELECT ai.id, ai.product_id, ai.quantity_used
    FROM public.application_items ai
    WHERE ai.application_id = target_application_id
  LOOP
    UPDATE public.products
    SET current_stock = current_stock + item.quantity_used,
        updated_at = now()
    WHERE id = item.product_id;

    DELETE FROM public.inventory_movements
    WHERE application_item_id = item.id;
  END LOOP;

  DELETE FROM public.application_items WHERE application_id = target_application_id;
  DELETE FROM public.applications WHERE id = target_application_id;
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
DECLARE
  app_record RECORD;
  item_record RECORD;
BEGIN
  IF NOT public.is_admin_or_editor(target_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  FOR app_record IN 
    SELECT a.id
    FROM public.applications a
    JOIN public.fields f ON a.field_id = f.id
    WHERE f.company_id = target_company_id
  LOOP
    FOR item_record IN
      SELECT ai.id, ai.product_id, ai.quantity_used
      FROM public.application_items ai
      WHERE ai.application_id = app_record.id
    LOOP
      UPDATE public.products
      SET current_stock = current_stock + item_record.quantity_used,
          updated_at = now()
      WHERE id = item_record.product_id;

      DELETE FROM public.inventory_movements
      WHERE application_item_id = item_record.id;
    END LOOP;
  END LOOP;

  DELETE FROM public.applications
  WHERE id IN (
    SELECT a.id
    FROM public.applications a
    JOIN public.fields f ON a.field_id = f.id
    WHERE f.company_id = target_company_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_all_applications_restore_stock(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_all_applications_restore_stock(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_machinery_assignments_summary(p_company_id uuid)
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
  SELECT 
    ma.invoice_item_id,
    COALESCE(SUM(ma.assigned_amount), 0) as total_assigned
  FROM public.machinery_assignments ma
  JOIN public.invoice_items ii ON ma.invoice_item_id = ii.id
  JOIN public.invoices i ON ii.invoice_id = i.id
  WHERE i.company_id = p_company_id
  GROUP BY ma.invoice_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_machinery_assignments_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_machinery_assignments_summary(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_labor_assignments_summary(p_company_id uuid)
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
  SELECT 
    la.invoice_item_id,
    COALESCE(SUM(la.assigned_amount), 0) as total_assigned
  FROM public.labor_assignments la
  JOIN public.invoice_items ii ON la.invoice_item_id = ii.id
  JOIN public.invoices i ON ii.invoice_id = i.id
  WHERE i.company_id = p_company_id
  GROUP BY la.invoice_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_labor_assignments_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_labor_assignments_summary(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_irrigation_assignments_summary(p_company_id uuid)
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
  SELECT 
    ia.invoice_item_id,
    COALESCE(SUM(ia.assigned_amount), 0) as total_assigned
  FROM public.irrigation_assignments ia
  JOIN public.invoice_items ii ON ia.invoice_item_id = ii.id
  JOIN public.invoices i ON ii.invoice_id = i.id
  WHERE i.company_id = p_company_id
  GROUP BY ia.invoice_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_irrigation_assignments_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_irrigation_assignments_summary(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_machinery_assignments_by_company(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_editor(p_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  DELETE FROM public.machinery_assignments ma
  USING public.invoice_items ii, public.invoices i
  WHERE ma.invoice_item_id = ii.id
    AND ii.invoice_id = i.id
    AND i.company_id = p_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_machinery_assignments_by_company(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_machinery_assignments_by_company(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_labor_assignments_by_company(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_editor(p_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  DELETE FROM public.labor_assignments la
  USING public.invoice_items ii, public.invoices i
  WHERE la.invoice_item_id = ii.id
    AND ii.invoice_id = i.id
    AND i.company_id = p_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_labor_assignments_by_company(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_labor_assignments_by_company(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_irrigation_assignments_by_company(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_editor(p_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  DELETE FROM public.irrigation_assignments ia
  USING public.invoice_items ii, public.invoices i
  WHERE ia.invoice_item_id = ii.id
    AND ii.invoice_id = i.id
    AND i.company_id = p_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_irrigation_assignments_by_company(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_irrigation_assignments_by_company(uuid) TO authenticated;

