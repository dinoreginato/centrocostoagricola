-- RPC for Machinery Assignments Summary
CREATE OR REPLACE FUNCTION public.get_machinery_assignments_summary(p_company_id uuid)
RETURNS TABLE (
    invoice_item_id uuid,
    total_assigned numeric
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

-- RPC for Labor Assignments Summary
CREATE OR REPLACE FUNCTION public.get_labor_assignments_summary(p_company_id uuid)
RETURNS TABLE (
    invoice_item_id uuid,
    total_assigned numeric
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

-- RPC for Irrigation Assignments Summary
CREATE OR REPLACE FUNCTION public.get_irrigation_assignments_summary(p_company_id uuid)
RETURNS TABLE (
    invoice_item_id uuid,
    total_assigned numeric
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
