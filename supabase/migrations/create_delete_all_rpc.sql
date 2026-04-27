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
