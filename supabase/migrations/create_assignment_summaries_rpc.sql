-- RPC for Machinery Assignments Summary
CREATE OR REPLACE FUNCTION get_machinery_assignments_summary(p_company_id uuid)
RETURNS TABLE (
    invoice_item_id uuid,
    total_assigned numeric
)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT 
        ma.invoice_item_id,
        COALESCE(SUM(ma.assigned_amount), 0) as total_assigned
    FROM machinery_assignments ma
    JOIN invoice_items ii ON ma.invoice_item_id = ii.id
    JOIN invoices i ON ii.invoice_id = i.id
    WHERE i.company_id = p_company_id
    GROUP BY ma.invoice_item_id;
$$;

-- RPC for Labor Assignments Summary
CREATE OR REPLACE FUNCTION get_labor_assignments_summary(p_company_id uuid)
RETURNS TABLE (
    invoice_item_id uuid,
    total_assigned numeric
)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT 
        la.invoice_item_id,
        COALESCE(SUM(la.assigned_amount), 0) as total_assigned
    FROM labor_assignments la
    JOIN invoice_items ii ON la.invoice_item_id = ii.id
    JOIN invoices i ON ii.invoice_id = i.id
    WHERE i.company_id = p_company_id
    GROUP BY la.invoice_item_id;
$$;

-- RPC for Irrigation Assignments Summary
CREATE OR REPLACE FUNCTION get_irrigation_assignments_summary(p_company_id uuid)
RETURNS TABLE (
    invoice_item_id uuid,
    total_assigned numeric
)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT 
        ia.invoice_item_id,
        COALESCE(SUM(ia.assigned_amount), 0) as total_assigned
    FROM irrigation_assignments ia
    JOIN invoice_items ii ON ia.invoice_item_id = ii.id
    JOIN invoices i ON ii.invoice_id = i.id
    WHERE i.company_id = p_company_id
    GROUP BY ia.invoice_item_id;
$$;
