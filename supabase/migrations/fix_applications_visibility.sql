-- Create a secure RPC to fetch applications with full nested details
-- This bypasses RLS on joined tables (fields, sectors, products) to ensure visibility for all members.

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
    a.total_cost,
    a.water_liters_per_hectare,
    json_build_object('name', f.name, 'company_id', f.company_id) as field,
    json_build_object('name', s.name, 'hectares', s.hectares) as sector,
    COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'quantity_used', ai.quantity_used,
            'dose_per_hectare', ai.dose_per_hectare,
            'total_cost', ai.total_cost,
            'product', json_build_object('name', p.name, 'unit', p.unit)
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
