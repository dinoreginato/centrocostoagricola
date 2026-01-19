-- Fix RPC again, ensuring explicit column selection to avoid ambiguity
-- Sometimes JOINs can cause issues if column names are ambiguous in the select list.
-- Also, let's verify if the JOINs are INNER or LEFT. If a sector was deleted (unlikely with FK) or if data is inconsistent, INNER JOIN might hide rows.
-- But sectors are required for applications.
-- Let's try to debug by making it robust.

CREATE OR REPLACE FUNCTION get_company_applications(company_id_input uuid)
RETURNS TABLE (
  id uuid,
  application_date date,
  application_type text,
  total_cost numeric,
  water_liters_per_hectare numeric,
  field json,
  sector json,
  application_items json
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id,
    a.application_date,
    a.application_type,
    COALESCE(a.total_cost, 0) as total_cost,
    COALESCE(a.water_liters_per_hectare, 0) as water_liters_per_hectare,
    json_build_object('id', f.id, 'name', f.name, 'company_id', f.company_id) as field,
    json_build_object('id', s.id, 'name', s.name, 'hectares', s.hectares) as sector,
    COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'product_id', ai.product_id,
            'quantity_used', ai.quantity_used,
            'dose_per_hectare', ai.dose_per_hectare,
            'unit_cost', ai.unit_cost,
            'total_cost', ai.total_cost,
            'product', json_build_object('id', p.id, 'name', p.name, 'unit', p.unit)
          )
        )
        FROM application_items ai
        JOIN products p ON ai.product_id = p.id
        WHERE ai.application_id = a.id
      ),
      '[]'::json
    ) as application_items
  FROM applications a
  JOIN fields f ON a.field_id = f.id
  JOIN sectors s ON a.sector_id = s.id
  WHERE f.company_id = company_id_input
  ORDER BY a.application_date DESC;
END;
$$;
