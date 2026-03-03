CREATE OR REPLACE FUNCTION get_general_costs_summary(p_company_id UUID)
RETURNS TABLE (invoice_item_id UUID, total_assigned NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT gc.invoice_item_id, COALESCE(SUM(gc.amount), 0)
    FROM general_costs gc
    WHERE gc.company_id = p_company_id
    AND gc.invoice_item_id IS NOT NULL
    GROUP BY gc.invoice_item_id;
END;
$$;
