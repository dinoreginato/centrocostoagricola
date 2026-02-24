-- RPC to delete ALL Machinery Assignments for a specific company
CREATE OR REPLACE FUNCTION delete_machinery_assignments_by_company(p_company_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
    DELETE FROM machinery_assignments ma
    USING invoice_items ii, invoices i
    WHERE ma.invoice_item_id = ii.id
    AND ii.invoice_id = i.id
    AND i.company_id = p_company_id;
$$;

-- RPC to delete ALL Labor Assignments for a specific company
CREATE OR REPLACE FUNCTION delete_labor_assignments_by_company(p_company_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
    DELETE FROM labor_assignments la
    USING invoice_items ii, invoices i
    WHERE la.invoice_item_id = ii.id
    AND ii.invoice_id = i.id
    AND i.company_id = p_company_id;
$$;

-- RPC to delete ALL Irrigation Assignments for a specific company
CREATE OR REPLACE FUNCTION delete_irrigation_assignments_by_company(p_company_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
    DELETE FROM irrigation_assignments ia
    USING invoice_items ii, invoices i
    WHERE ia.invoice_item_id = ii.id
    AND ii.invoice_id = i.id
    AND i.company_id = p_company_id;
$$;
